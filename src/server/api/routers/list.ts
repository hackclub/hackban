import { z } from "zod";

import { boardIdForList, logActivity, requireBoard, touch } from "~/server/api/access";
import { posAfter, posAtEnd, sequentialKeys } from "~/server/api/pos";
import { removeStored, storedKeys } from "~/server/storage";
import { createTRPCRouter, protectedProcedure } from "~/server/api/trpc";

export const listRouter = createTRPCRouter({
  create: protectedProcedure
    .input(z.object({ boardId: z.string(), name: z.string().min(1).max(512) }))
    .mutation(async ({ ctx, input }) => {
      await requireBoard(ctx.db, ctx.session.user.id, input.boardId);
      const siblings = await ctx.db.list.findMany({
        where: { boardId: input.boardId, closed: false },
        orderBy: { pos: "asc" },
        select: { id: true, pos: true },
      });
      const list = await ctx.db.list.create({
        data: { boardId: input.boardId, name: input.name, pos: posAtEnd(siblings) },
      });
      logActivity(ctx.db, { boardId: input.boardId, actorId: ctx.session.user.id, type: "createList", data: { name: list.name }, origin: ctx.clientId });
      return list;
    }),

  update: protectedProcedure
    .input(
      z.object({
        id: z.string(),
        name: z.string().min(1).max(512).optional(),
        description: z.string().max(4096).optional(),
        color: z.string().max(32).nullable().optional(),
        closed: z.boolean().optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const boardId = await boardIdForList(ctx.db, input.id);
      await requireBoard(ctx.db, ctx.session.user.id, boardId);
      const { id, ...data } = input;
      const list = await ctx.db.list.update({ where: { id }, data });
      // Color and description changes have no activity entry.
      if (input.name === undefined && input.closed === undefined) {
        touch(boardId, undefined, ctx.clientId);
        return list;
      }
      const type = input.closed === true ? "archiveList" : input.closed === false ? "restoreList" : "renameList";
      logActivity(ctx.db, { boardId, actorId: ctx.session.user.id, type, data: { name: list.name }, origin: ctx.clientId });
      return list;
    }),

  /** Move list within its board or to another board, after `afterId` (null = first). */
  move: protectedProcedure
    .input(z.object({ id: z.string(), boardId: z.string().optional(), afterId: z.string().nullable() }))
    .mutation(async ({ ctx, input }) => {
      const fromBoard = await boardIdForList(ctx.db, input.id);
      const toBoard = input.boardId ?? fromBoard;
      await requireBoard(ctx.db, ctx.session.user.id, fromBoard);
      if (toBoard !== fromBoard) await requireBoard(ctx.db, ctx.session.user.id, toBoard);
      const siblings = await ctx.db.list.findMany({
        where: { boardId: toBoard, closed: false, id: { not: input.id } },
        orderBy: { pos: "asc" },
        select: { id: true, pos: true },
      });
      const list = await ctx.db.list.update({
        where: { id: input.id },
        data: { boardId: toBoard, pos: posAfter(siblings, input.afterId) },
      });
      if (toBoard !== fromBoard) {
        // Labels are board-scoped, so drop links to the old board's labels.
        await ctx.db.cardLabel.deleteMany({ where: { card: { listId: input.id }, label: { boardId: fromBoard } } });
        logActivity(ctx.db, { boardId: fromBoard, actorId: ctx.session.user.id, type: "moveListFromBoard", data: { name: list.name }, origin: ctx.clientId });
      }
      logActivity(ctx.db, { boardId: toBoard, actorId: ctx.session.user.id, type: "moveList", data: { name: list.name }, origin: ctx.clientId });
      return list;
    }),

  copy: protectedProcedure
    .input(z.object({ id: z.string(), name: z.string().min(1).max(512) }))
    .mutation(async ({ ctx, input }) => {
      const src = await ctx.db.list.findUniqueOrThrow({
        where: { id: input.id },
        include: {
          cards: {
            where: { closed: false },
            include: { labels: true, members: true, checklists: { include: { items: true } } },
          },
        },
      });
      await requireBoard(ctx.db, ctx.session.user.id, src.boardId);
      const siblings = await ctx.db.list.findMany({
        where: { boardId: src.boardId, closed: false },
        orderBy: { pos: "asc" },
        select: { id: true, pos: true },
      });
      const list = await ctx.db.list.create({
        data: {
          boardId: src.boardId,
          name: input.name,
          description: src.description,
          color: src.color,
          pos: posAfter(siblings, src.id),
          cards: {
            create: src.cards.map((c) => ({
              title: c.title,
              description: c.description,
              pos: c.pos,
              start: c.start,
              due: c.due,
              dueComplete: c.dueComplete,
              coverColor: c.coverColor,
              labels: { create: c.labels.map((l) => ({ labelId: l.labelId })) },
              members: { create: c.members.map((m) => ({ userId: m.userId })) },
              checklists: {
                create: c.checklists.map((cl) => ({
                  name: cl.name,
                  pos: cl.pos,
                  items: { create: cl.items.map((i) => ({ name: i.name, pos: i.pos, complete: i.complete, due: i.due, memberId: i.memberId })) },
                })),
              },
            })),
          },
        },
      });
      logActivity(ctx.db, { boardId: src.boardId, actorId: ctx.session.user.id, type: "createList", data: { name: list.name }, origin: ctx.clientId });
      return list;
    }),

  /** Move every card from one list into another (Trello's "Move all cards in this list"). */
  moveAllCards: protectedProcedure
    .input(z.object({ id: z.string(), toListId: z.string() }))
    .mutation(async ({ ctx, input }) => {
      const boardId = await boardIdForList(ctx.db, input.id);
      await requireBoard(ctx.db, ctx.session.user.id, boardId);
      const toBoard = await boardIdForList(ctx.db, input.toListId);
      await requireBoard(ctx.db, ctx.session.user.id, toBoard);
      const [cards, dest] = await Promise.all([
        ctx.db.card.findMany({ where: { listId: input.id, closed: false }, orderBy: { pos: "asc" } }),
        ctx.db.card.findMany({ where: { listId: input.toListId, closed: false }, orderBy: { pos: "asc" }, select: { id: true, pos: true } }),
      ]);
      let tail = dest;
      for (const c of cards) {
        const pos = posAtEnd(tail);
        await ctx.db.card.update({ where: { id: c.id }, data: { listId: input.toListId, pos } });
        tail = [...tail, { id: c.id, pos }];
      }
      logActivity(ctx.db, { boardId, actorId: ctx.session.user.id, type: "moveAllCards", data: { count: cards.length }, origin: ctx.clientId });
    }),

  /** Reorder a list's cards to match `ids` (the client computes the sort). */
  sortCards: protectedProcedure
    .input(z.object({ id: z.string(), ids: z.array(z.string()).max(5000) }))
    .mutation(async ({ ctx, input }) => {
      const boardId = await boardIdForList(ctx.db, input.id);
      await requireBoard(ctx.db, ctx.session.user.id, boardId);
      const cards = await ctx.db.card.findMany({ where: { listId: input.id, closed: false }, orderBy: { pos: "asc" }, select: { id: true } });
      const rank = new Map(input.ids.map((id, i) => [id, i]));
      // Cards the client didn't know about (added mid-sort) keep their relative order at the end.
      const order = [...cards].sort((a, b) => (rank.get(a.id) ?? rank.size) - (rank.get(b.id) ?? rank.size));
      const keys = sequentialKeys(order.length);
      await ctx.db.$transaction(order.map((c, i) => ctx.db.card.update({ where: { id: c.id }, data: { pos: keys[i]! } })));
      logActivity(ctx.db, { boardId, actorId: ctx.session.user.id, type: "sortList", origin: ctx.clientId });
    }),

  archiveAllCards: protectedProcedure
    .input(z.object({ id: z.string() }))
    .mutation(async ({ ctx, input }) => {
      const boardId = await boardIdForList(ctx.db, input.id);
      await requireBoard(ctx.db, ctx.session.user.id, boardId);
      await ctx.db.card.updateMany({ where: { listId: input.id }, data: { closed: true } });
      logActivity(ctx.db, { boardId, actorId: ctx.session.user.id, type: "archiveAllCards", origin: ctx.clientId });
    }),

  delete: protectedProcedure
    .input(z.object({ id: z.string() }))
    .mutation(async ({ ctx, input }) => {
      const boardId = await boardIdForList(ctx.db, input.id);
      await requireBoard(ctx.db, ctx.session.user.id, boardId);
      const keys = await storedKeys({ card: { listId: input.id } });
      await ctx.db.list.delete({ where: { id: input.id } });
      keys.forEach((k) => void removeStored(k));
      logActivity(ctx.db, { boardId, actorId: ctx.session.user.id, type: "deleteList", origin: ctx.clientId });
    }),
});

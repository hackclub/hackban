import { TRPCError } from "@trpc/server";
import { z } from "zod";

import { boardIdForList, logActivity, requireBoard, requireCard, touch } from "~/server/api/access";
import { posAfter, posAtEnd } from "~/server/api/pos";
import { createTRPCRouter, protectedProcedure } from "~/server/api/trpc";
import { removeStored, storedKeys } from "~/server/storage";
import { RECURRENCES, nextDue, type Recurrence } from "~/server/recurrence";
import { type db as Db } from "~/server/db";

/** Assignees (card members, check item owners) must be on the board. */
async function requireBoardMember(db: typeof Db, boardId: string, userId: string) {
  const m = await db.boardMember.findUnique({ where: { boardId_userId: { boardId, userId } } });
  if (!m) throw new TRPCError({ code: "BAD_REQUEST", message: "That person isn't a member of this board." });
}

const userSelect = { id: true, name: true, image: true, username: true } as const;

export const cardRouter = createTRPCRouter({
  get: protectedProcedure
    .input(z.object({ id: z.string() }))
    .query(async ({ ctx, input }) => {
      const userId = ctx.session.user.id;
      await requireCard(ctx.db, userId, input.id, false);
      const card = await ctx.db.card.findUniqueOrThrow({
        where: { id: input.id },
        include: {
          list: { select: { id: true, name: true, boardId: true, board: { select: { name: true } } } },
          labels: { include: { label: true } },
          members: { include: { user: { select: userSelect } } },
          checklists: {
            orderBy: { pos: "asc" },
            include: { items: { orderBy: { pos: "asc" }, include: { member: { select: userSelect } } } },
          },
          attachments: { orderBy: { createdAt: "desc" }, include: { uploader: { select: userSelect } } },
          comments: { orderBy: { createdAt: "desc" }, include: { author: { select: userSelect } } },
          activities: {
            orderBy: { createdAt: "desc" },
            take: 50,
            include: { actor: { select: userSelect } },
          },
          watches: { where: { userId } },
        },
      });
      const { watches, activities, ...rest } = card;
      return {
        ...rest,
        watching: watches.length > 0,
        activities: activities.map((a) => ({ ...a, data: JSON.parse(a.data) as Record<string, unknown> })),
      };
    }),

  create: protectedProcedure
    .input(
      z.object({
        listId: z.string(),
        title: z.string().min(1).max(16384),
        // null = top of list, undefined = bottom
        afterId: z.string().nullable().optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const boardId = await boardIdForList(ctx.db, input.listId);
      await requireBoard(ctx.db, ctx.session.user.id, boardId);
      const siblings = await ctx.db.card.findMany({
        where: { listId: input.listId, closed: false },
        orderBy: { pos: "asc" },
        select: { id: true, pos: true },
      });
      const pos = input.afterId === undefined ? posAtEnd(siblings) : posAfter(siblings, input.afterId);
      const card = await ctx.db.card.create({
        data: { listId: input.listId, title: input.title, pos },
      });
      logActivity(ctx.db, { boardId, cardId: card.id, actorId: ctx.session.user.id, type: "createCard", data: { title: card.title }, origin: ctx.clientId });
      return card;
    }),

  update: protectedProcedure
    .input(
      z.object({
        id: z.string(),
        title: z.string().min(1).max(16384).optional(),
        description: z.string().max(16384).optional(),
        start: z.date().nullable().optional(),
        due: z.date().nullable().optional(),
        dueComplete: z.boolean().optional(),
        coverColor: z.string().nullable().optional(),
        coverAttachmentId: z.string().nullable().optional(),
        coverSize: z.enum(["normal", "full"]).optional(),
        closed: z.boolean().optional(),
        recurrence: z.enum(RECURRENCES).nullable().optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const boardId = await requireCard(ctx.db, ctx.session.user.id, input.id);
      const { id, ...data } = input;
      if (data.coverColor) data.coverAttachmentId = null;
      if (data.coverAttachmentId) data.coverColor = null;
      let card = await ctx.db.card.update({ where: { id }, data });

      // Repeating card marked complete: roll it to the next occurrence instead
      // of leaving it done (Trello's "Repeat"). Checklists reset for next time.
      if (input.dueComplete === true && card.recurrence && card.due) {
        const next = nextDue(card.due, card.recurrence as Recurrence, new Date(), ctx.tzOffset);
        const shift = next.getTime() - card.due.getTime();
        card = await ctx.db.card.update({
          where: { id },
          data: { due: next, start: card.start ? new Date(card.start.getTime() + shift) : null, dueComplete: false },
        });
        await ctx.db.checkItem.updateMany({ where: { checklist: { cardId: id } }, data: { complete: false } });
        logActivity(ctx.db, {
          boardId,
          cardId: id,
          actorId: ctx.session.user.id,
          type: "recurCard",
          data: { title: card.title, due: next },
          origin: ctx.clientId,
        });
        return card;
      }
      const type =
        input.closed === true ? "archiveCard"
        : input.closed === false ? "restoreCard"
        : input.dueComplete !== undefined ? (input.dueComplete ? "completeDue" : "incompleteDue")
        : input.due !== undefined ? "changeDue"
        : input.recurrence !== undefined ? "changeRecurrence"
        : input.title ? "renameCard"
        : input.description !== undefined ? "updateDescription"
        : null;
      if (type) {
        logActivity(ctx.db, { boardId, cardId: id, actorId: ctx.session.user.id, type, data: { title: card.title, due: card.due, recurrence: card.recurrence }, origin: ctx.clientId });
      } else {
        touch(boardId, id, ctx.clientId);
      }
      return card;
    }),

  move: protectedProcedure
    .input(z.object({ id: z.string(), listId: z.string(), afterId: z.string().nullable() }))
    .mutation(async ({ ctx, input }) => {
      const before = await ctx.db.card.findUniqueOrThrow({
        where: { id: input.id },
        include: { list: true },
      });
      await requireBoard(ctx.db, ctx.session.user.id, before.list.boardId);
      const toBoard = await boardIdForList(ctx.db, input.listId);
      if (toBoard !== before.list.boardId) await requireBoard(ctx.db, ctx.session.user.id, toBoard);
      const siblings = await ctx.db.card.findMany({
        where: { listId: input.listId, closed: false, id: { not: input.id } },
        orderBy: { pos: "asc" },
        select: { id: true, pos: true },
      });
      const card = await ctx.db.card.update({
        where: { id: input.id },
        data: { listId: input.listId, pos: posAfter(siblings, input.afterId) },
        include: { list: true },
      });
      if (toBoard !== before.list.boardId) {
        await ctx.db.cardLabel.deleteMany({ where: { cardId: card.id } });
        touch(before.list.boardId, undefined, ctx.clientId);
      }
      if (before.listId !== input.listId) {
        logActivity(ctx.db, {
          boardId: toBoard,
          cardId: card.id,
          actorId: ctx.session.user.id,
          type: "moveCard",
          data: { title: card.title, from: before.list.name, to: card.list.name },
          origin: ctx.clientId,
        });
      } else {
        touch(toBoard, undefined, ctx.clientId);
      }
      return card;
    }),

  copy: protectedProcedure
    .input(
      z.object({
        id: z.string(),
        title: z.string().min(1).max(16384),
        listId: z.string(),
        afterId: z.string().nullable().optional(),
        keep: z.object({ checklists: z.boolean(), labels: z.boolean(), members: z.boolean(), attachments: z.boolean() }),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      await requireCard(ctx.db, ctx.session.user.id, input.id, false);
      const toBoard = await boardIdForList(ctx.db, input.listId);
      await requireBoard(ctx.db, ctx.session.user.id, toBoard);
      const src = await ctx.db.card.findUniqueOrThrow({
        where: { id: input.id },
        include: { labels: true, members: true, attachments: true, checklists: { include: { items: true } }, list: true },
      });
      const sameBoard = src.list.boardId === toBoard;
      const siblings = await ctx.db.card.findMany({
        where: { listId: input.listId, closed: false },
        orderBy: { pos: "asc" },
        select: { id: true, pos: true },
      });
      const card = await ctx.db.card.create({
        data: {
          listId: input.listId,
          title: input.title,
          description: src.description,
          pos: input.afterId === undefined ? posAtEnd(siblings) : posAfter(siblings, input.afterId),
          start: src.start,
          due: src.due,
          recurrence: src.recurrence,
          coverColor: src.coverColor,
          labels: input.keep.labels && sameBoard ? { create: src.labels.map((l) => ({ labelId: l.labelId })) } : undefined,
          members: input.keep.members ? { create: src.members.map((m) => ({ userId: m.userId })) } : undefined,
          attachments: input.keep.attachments
            ? { create: src.attachments.map(({ id: _id, cardId: _c, trelloId: _t, createdAt: _d, ...a }) => a) }
            : undefined,
          checklists: input.keep.checklists
            ? {
                create: src.checklists.map((cl) => ({
                  name: cl.name,
                  pos: cl.pos,
                  items: { create: cl.items.map((i) => ({ name: i.name, pos: i.pos, complete: i.complete, due: i.due, memberId: i.memberId })) },
                })),
              }
            : undefined,
        },
      });
      logActivity(ctx.db, { boardId: toBoard, cardId: card.id, actorId: ctx.session.user.id, type: "copyCard", data: { title: card.title, from: src.title }, origin: ctx.clientId });
      return card;
    }),

  delete: protectedProcedure
    .input(z.object({ id: z.string() }))
    .mutation(async ({ ctx, input }) => {
      const boardId = await requireCard(ctx.db, ctx.session.user.id, input.id);
      const keys = await storedKeys({ cardId: input.id });
      const card = await ctx.db.card.delete({ where: { id: input.id } });
      keys.forEach((k) => void removeStored(k));
      logActivity(ctx.db, { boardId, actorId: ctx.session.user.id, type: "deleteCard", data: { title: card.title }, origin: ctx.clientId });
    }),

  toggleLabel: protectedProcedure
    .input(z.object({ id: z.string(), labelId: z.string(), on: z.boolean() }))
    .mutation(async ({ ctx, input }) => {
      const boardId = await requireCard(ctx.db, ctx.session.user.id, input.id);
      const label = await ctx.db.label.findUniqueOrThrow({ where: { id: input.labelId } });
      if (label.boardId !== boardId) throw new TRPCError({ code: "BAD_REQUEST" });
      if (input.on) {
        await ctx.db.cardLabel.upsert({
          where: { cardId_labelId: { cardId: input.id, labelId: input.labelId } },
          create: { cardId: input.id, labelId: input.labelId },
          update: {},
        });
      } else {
        await ctx.db.cardLabel.deleteMany({ where: { cardId: input.id, labelId: input.labelId } });
      }
      touch(boardId, input.id, ctx.clientId);
    }),

  toggleMember: protectedProcedure
    .input(z.object({ id: z.string(), userId: z.string(), on: z.boolean() }))
    .mutation(async ({ ctx, input }) => {
      const boardId = await requireCard(ctx.db, ctx.session.user.id, input.id);
      if (input.on && input.userId !== ctx.session.user.id) await requireBoardMember(ctx.db, boardId, input.userId);
      if (input.on) {
        await ctx.db.cardMember.upsert({
          where: { cardId_userId: { cardId: input.id, userId: input.userId } },
          create: { cardId: input.id, userId: input.userId },
          update: {},
        });
        if (input.userId !== ctx.session.user.id) {
          const card = await ctx.db.card.findUniqueOrThrow({ where: { id: input.id } });
          await ctx.db.notification.create({
            data: {
              userId: input.userId,
              type: "addedToCard",
              data: JSON.stringify({ cardId: card.id, title: card.title, boardId, by: ctx.session.user.name }),
            },
          });
        }
      } else {
        await ctx.db.cardMember.deleteMany({ where: { cardId: input.id, userId: input.userId } });
      }
      logActivity(ctx.db, {
        boardId,
        cardId: input.id,
        actorId: ctx.session.user.id,
        type: input.on ? "addMemberToCard" : "removeMemberFromCard",
        data: { userId: input.userId },
        origin: ctx.clientId,
      });
    }),

  watch: protectedProcedure
    .input(z.object({ id: z.string(), on: z.boolean() }))
    .mutation(async ({ ctx, input }) => {
      const userId = ctx.session.user.id;
      await requireCard(ctx.db, userId, input.id, false);
      await ctx.db.watch.deleteMany({ where: { userId, cardId: input.id } });
      if (input.on) await ctx.db.watch.create({ data: { userId, cardId: input.id } });
    }),

  // ----- Labels (board-scoped, edited from the card's label popover) -----

  createLabel: protectedProcedure
    .input(z.object({ boardId: z.string(), name: z.string().max(100), color: z.string().nullable() }))
    .mutation(async ({ ctx, input }) => {
      await requireBoard(ctx.db, ctx.session.user.id, input.boardId);
      const label = await ctx.db.label.create({ data: input });
      touch(input.boardId, undefined, ctx.clientId);
      return label;
    }),

  updateLabel: protectedProcedure
    .input(z.object({ id: z.string(), name: z.string().max(100), color: z.string().nullable() }))
    .mutation(async ({ ctx, input }) => {
      const label = await ctx.db.label.findUniqueOrThrow({ where: { id: input.id } });
      await requireBoard(ctx.db, ctx.session.user.id, label.boardId);
      await ctx.db.label.update({ where: { id: input.id }, data: { name: input.name, color: input.color } });
      touch(label.boardId, undefined, ctx.clientId);
    }),

  deleteLabel: protectedProcedure
    .input(z.object({ id: z.string() }))
    .mutation(async ({ ctx, input }) => {
      const label = await ctx.db.label.findUniqueOrThrow({ where: { id: input.id } });
      await requireBoard(ctx.db, ctx.session.user.id, label.boardId);
      await ctx.db.label.delete({ where: { id: input.id } });
      touch(label.boardId, undefined, ctx.clientId);
    }),

  // ----- Checklists -----

  addChecklist: protectedProcedure
    .input(z.object({ id: z.string(), name: z.string().min(1).max(512), copyFrom: z.string().optional() }))
    .mutation(async ({ ctx, input }) => {
      const boardId = await requireCard(ctx.db, ctx.session.user.id, input.id);
      const siblings = await ctx.db.checklist.findMany({ where: { cardId: input.id }, orderBy: { pos: "asc" }, select: { id: true, pos: true } });
      // Only copy from a checklist on this same card (what the UI offers);
      // otherwise any checklist's contents could be read by id.
      const src = input.copyFrom
        ? await ctx.db.checklist.findFirst({ where: { id: input.copyFrom, cardId: input.id }, include: { items: true } })
        : null;
      await ctx.db.checklist.create({
        data: {
          cardId: input.id,
          name: input.name,
          pos: posAtEnd(siblings),
          items: src ? { create: src.items.map((i) => ({ name: i.name, pos: i.pos })) } : undefined,
        },
      });
      logActivity(ctx.db, { boardId, cardId: input.id, actorId: ctx.session.user.id, type: "addChecklist", data: { name: input.name }, origin: ctx.clientId });
    }),

  updateChecklist: protectedProcedure
    .input(z.object({ checklistId: z.string(), name: z.string().min(1).max(512) }))
    .mutation(async ({ ctx, input }) => {
      const cl = await ctx.db.checklist.findUniqueOrThrow({ where: { id: input.checklistId } });
      const boardId = await requireCard(ctx.db, ctx.session.user.id, cl.cardId);
      await ctx.db.checklist.update({ where: { id: cl.id }, data: { name: input.name } });
      touch(boardId, cl.cardId, ctx.clientId);
    }),

  deleteChecklist: protectedProcedure
    .input(z.object({ checklistId: z.string() }))
    .mutation(async ({ ctx, input }) => {
      const cl = await ctx.db.checklist.findUniqueOrThrow({ where: { id: input.checklistId } });
      const boardId = await requireCard(ctx.db, ctx.session.user.id, cl.cardId);
      await ctx.db.checklist.delete({ where: { id: cl.id } });
      logActivity(ctx.db, { boardId, cardId: cl.cardId, actorId: ctx.session.user.id, type: "removeChecklist", data: { name: cl.name }, origin: ctx.clientId });
    }),

  addCheckItem: protectedProcedure
    .input(z.object({ checklistId: z.string(), name: z.string().min(1).max(16384) }))
    .mutation(async ({ ctx, input }) => {
      const cl = await ctx.db.checklist.findUniqueOrThrow({ where: { id: input.checklistId }, include: { items: { orderBy: { pos: "asc" }, select: { id: true, pos: true } } } });
      const boardId = await requireCard(ctx.db, ctx.session.user.id, cl.cardId);
      await ctx.db.checkItem.create({ data: { checklistId: cl.id, name: input.name, pos: posAtEnd(cl.items) } });
      touch(boardId, cl.cardId, ctx.clientId);
    }),

  updateCheckItem: protectedProcedure
    .input(
      z.object({
        itemId: z.string(),
        name: z.string().min(1).max(16384).optional(),
        complete: z.boolean().optional(),
        due: z.date().nullable().optional(),
        memberId: z.string().nullable().optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const item = await ctx.db.checkItem.findUniqueOrThrow({ where: { id: input.itemId }, include: { checklist: true } });
      const boardId = await requireCard(ctx.db, ctx.session.user.id, item.checklist.cardId);
      if (input.memberId) await requireBoardMember(ctx.db, boardId, input.memberId);
      const { itemId, ...data } = input;
      await ctx.db.checkItem.update({ where: { id: itemId }, data });
      if (input.complete !== undefined) {
        logActivity(ctx.db, {
          boardId,
          cardId: item.checklist.cardId,
          actorId: ctx.session.user.id,
          type: input.complete ? "completeCheckItem" : "incompleteCheckItem",
          data: { name: item.name },
          origin: ctx.clientId,
        });
      } else {
        touch(boardId, item.checklist.cardId, ctx.clientId);
      }
    }),

  moveCheckItem: protectedProcedure
    .input(z.object({ itemId: z.string(), checklistId: z.string(), afterId: z.string().nullable() }))
    .mutation(async ({ ctx, input }) => {
      const item = await ctx.db.checkItem.findUniqueOrThrow({ where: { id: input.itemId }, include: { checklist: true } });
      const boardId = await requireCard(ctx.db, ctx.session.user.id, item.checklist.cardId);
      // The target checklist must be on the same card; otherwise items could be
      // planted into any board's checklists.
      const target = await ctx.db.checklist.findFirst({ where: { id: input.checklistId, cardId: item.checklist.cardId } });
      if (!target) throw new TRPCError({ code: "BAD_REQUEST", message: "Items can only move between checklists on the same card." });
      const siblings = await ctx.db.checkItem.findMany({
        where: { checklistId: input.checklistId, id: { not: input.itemId } },
        orderBy: { pos: "asc" },
        select: { id: true, pos: true },
      });
      await ctx.db.checkItem.update({
        where: { id: input.itemId },
        data: { checklistId: input.checklistId, pos: posAfter(siblings, input.afterId) },
      });
      touch(boardId, item.checklist.cardId, ctx.clientId);
    }),

  deleteCheckItem: protectedProcedure
    .input(z.object({ itemId: z.string() }))
    .mutation(async ({ ctx, input }) => {
      const item = await ctx.db.checkItem.findUniqueOrThrow({ where: { id: input.itemId }, include: { checklist: true } });
      const boardId = await requireCard(ctx.db, ctx.session.user.id, item.checklist.cardId);
      await ctx.db.checkItem.delete({ where: { id: input.itemId } });
      touch(boardId, item.checklist.cardId, ctx.clientId);
    }),

  // ----- Comments -----

  addComment: protectedProcedure
    .input(z.object({ id: z.string(), text: z.string().min(1).max(16384) }))
    .mutation(async ({ ctx, input }) => {
      const boardId = await requireCard(ctx.db, ctx.session.user.id, input.id);
      const comment = await ctx.db.comment.create({ data: { cardId: input.id, authorId: ctx.session.user.id, text: input.text } });
      const watchers = await ctx.db.watch.findMany({ where: { cardId: input.id, userId: { not: ctx.session.user.id } } });
      if (watchers.length) {
        const card = await ctx.db.card.findUniqueOrThrow({ where: { id: input.id }, select: { title: true } });
        await ctx.db.notification.createMany({
          data: watchers.map((w) => ({
            userId: w.userId,
            type: "commentCard",
            data: JSON.stringify({ cardId: input.id, title: card.title, boardId, by: ctx.session.user.name, text: input.text.slice(0, 200) }),
          })),
        });
      }
      touch(boardId, input.id, ctx.clientId);
      return comment;
    }),

  editComment: protectedProcedure
    .input(z.object({ commentId: z.string(), text: z.string().min(1).max(16384) }))
    .mutation(async ({ ctx, input }) => {
      const c = await ctx.db.comment.findUniqueOrThrow({ where: { id: input.commentId } });
      if (c.authorId !== ctx.session.user.id) throw new TRPCError({ code: "FORBIDDEN" });
      const boardId = await requireCard(ctx.db, ctx.session.user.id, c.cardId);
      await ctx.db.comment.update({ where: { id: c.id }, data: { text: input.text, editedAt: new Date() } });
      touch(boardId, c.cardId, ctx.clientId);
    }),

  deleteComment: protectedProcedure
    .input(z.object({ commentId: z.string() }))
    .mutation(async ({ ctx, input }) => {
      const c = await ctx.db.comment.findUniqueOrThrow({ where: { id: input.commentId } });
      if (c.authorId !== ctx.session.user.id) throw new TRPCError({ code: "FORBIDDEN" });
      const boardId = await requireCard(ctx.db, ctx.session.user.id, c.cardId);
      await ctx.db.comment.delete({ where: { id: c.id } });
      touch(boardId, c.cardId, ctx.clientId);
    }),

  // ----- Attachments (links; uploads go through /api/files) -----

  addLink: protectedProcedure
    .input(
      z.object({
        id: z.string(),
        url: z.string().max(2048).url().refine((u) => /^https?:\/\//i.test(u), "Links must be http(s)"),
        name: z.string().max(256).optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const boardId = await requireCard(ctx.db, ctx.session.user.id, input.id);
      await ctx.db.attachment.create({
        data: { cardId: input.id, uploaderId: ctx.session.user.id, url: input.url, name: input.name ?? input.url },
      });
      logActivity(ctx.db, { boardId, cardId: input.id, actorId: ctx.session.user.id, type: "addAttachment", data: { name: input.name ?? input.url }, origin: ctx.clientId });
    }),

  updateAttachment: protectedProcedure
    .input(z.object({ attachmentId: z.string(), name: z.string().min(1).max(256) }))
    .mutation(async ({ ctx, input }) => {
      const a = await ctx.db.attachment.findUniqueOrThrow({ where: { id: input.attachmentId } });
      const boardId = await requireCard(ctx.db, ctx.session.user.id, a.cardId);
      await ctx.db.attachment.update({ where: { id: a.id }, data: { name: input.name } });
      touch(boardId, a.cardId, ctx.clientId);
    }),

  deleteAttachment: protectedProcedure
    .input(z.object({ attachmentId: z.string() }))
    .mutation(async ({ ctx, input }) => {
      const a = await ctx.db.attachment.findUniqueOrThrow({ where: { id: input.attachmentId } });
      const boardId = await requireCard(ctx.db, ctx.session.user.id, a.cardId);
      await ctx.db.attachment.delete({ where: { id: a.id } });
      void removeStored(a.storageKey);
      await ctx.db.card.updateMany({ where: { id: a.cardId, coverAttachmentId: a.id }, data: { coverAttachmentId: null } });
      touch(boardId, a.cardId, ctx.clientId);
    }),
});

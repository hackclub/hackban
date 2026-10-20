import { on } from "node:events";

import { TRPCError } from "@trpc/server";
import { z } from "zod";

import { logActivity, requireBoard, touch } from "~/server/api/access";
import { sequentialKeys } from "~/server/api/pos";
import { createTRPCRouter, protectedProcedure } from "~/server/api/trpc";
import { type db as Db } from "~/server/db";
import { boardBus, type BoardEvent } from "~/server/realtime";

export const DEFAULT_LABEL_COLORS = ["green", "yellow", "orange", "red", "purple", "blue"];

const cardFrontInclude = {
  labels: { include: { label: true } },
  members: { include: { user: { select: { id: true, name: true, image: true } } } },
  checklists: { include: { items: { select: { complete: true } } } },
  _count: { select: { comments: true, attachments: true } },
} as const;

/** A board must always keep at least one admin. */
async function assertAnotherAdmin(db: typeof Db, boardId: string, leavingUserId: string) {
  const others = await db.boardMember.count({ where: { boardId, role: "admin", userId: { not: leavingUserId } } });
  if (others === 0) throw new TRPCError({ code: "BAD_REQUEST", message: "A board needs at least one admin." });
}

export const boardRouter = createTRPCRouter({
  get: protectedProcedure
    .input(z.object({ id: z.string() }))
    .query(async ({ ctx, input }) => {
      const userId = ctx.session.user.id;
      const access = await requireBoard(ctx.db, userId, input.id, false);
      const board = await ctx.db.board.findUniqueOrThrow({
        where: { id: input.id },
        include: {
          workspace: { select: { id: true, name: true } },
          members: {
            include: { user: { select: { id: true, name: true, image: true, username: true, isGhost: true } } },
          },
          stars: { where: { userId } },
          labels: { orderBy: { color: "asc" } },
          lists: {
            where: { closed: false },
            orderBy: { pos: "asc" },
            include: {
              cards: {
                where: { closed: false },
                orderBy: { pos: "asc" },
                include: {
                  ...cardFrontInclude,
                  watches: { where: { userId }, select: { userId: true } },
                  attachments: {
                    select: { id: true, url: true, mimeType: true },
                  },
                },
              },
            },
          },
        },
      });
      void ctx.db.boardMember
        .updateMany({ where: { boardId: input.id, userId }, data: { lastViewed: new Date() } })
        .catch(() => undefined);
      const myRole = access.members[0]?.role ?? (board.visibility === "public" && !access.workspace.members[0] ? "observer" : "normal");
      const { stars, ...rest } = board;
      return {
        ...rest,
        starred: stars.length > 0,
        myRole,
        lists: rest.lists.map((l) => ({
          ...l,
          cards: l.cards.map(({ attachments, checklists, watches, ...c }) => ({
            ...c,
            watching: watches.length > 0,
            checkTotal: checklists.reduce((n, cl) => n + cl.items.length, 0),
            checkDone: checklists.reduce((n, cl) => n + cl.items.filter((i) => i.complete).length, 0),
            coverUrl: attachments.find((a) => a.id === c.coverAttachmentId)?.url ?? null,
          })),
        })),
      };
    }),

  create: protectedProcedure
    .input(
      z.object({
        name: z.string().min(1).max(200),
        workspaceId: z.string(),
        background: z.string().default("#0079bf"),
        visibility: z.enum(["private", "workspace", "public"]).default("workspace"),
        template: z.enum(["empty", "basic"]).default("basic"),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const userId = ctx.session.user.id;
      await ctx.db.workspaceMember.findFirstOrThrow({
        where: { workspaceId: input.workspaceId, userId },
      });
      const listNames = input.template === "basic" ? ["To Do", "Doing", "Done"] : [];
      const keys = sequentialKeys(listNames.length);
      const board = await ctx.db.board.create({
        data: {
          name: input.name,
          workspaceId: input.workspaceId,
          background: input.background,
          visibility: input.visibility,
          members: { create: { userId, role: "admin" } },
          labels: { create: DEFAULT_LABEL_COLORS.map((color) => ({ color })) },
          lists: { create: listNames.map((name, i) => ({ name, pos: keys[i]! })) },
        },
      });
      await logActivity(ctx.db, { boardId: board.id, actorId: userId, type: "createBoard", data: { name: board.name } });
      return board;
    }),

  update: protectedProcedure
    .input(
      z.object({
        id: z.string(),
        name: z.string().min(1).max(200).optional(),
        description: z.string().max(16384).optional(),
        background: z.string().optional(),
        bgImage: z.string().nullable().optional(),
        visibility: z.enum(["private", "workspace", "public"]).optional(),
        closed: z.boolean().optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const { id, ...data } = input;
      await requireBoard(ctx.db, ctx.session.user.id, id);
      const board = await ctx.db.board.update({ where: { id }, data });
      const type = input.closed === true ? "closeBoard" : input.closed === false ? "reopenBoard" : input.name ? "renameBoard" : "updateBoard";
      await logActivity(ctx.db, { boardId: id, actorId: ctx.session.user.id, type, data: { name: board.name }, origin: ctx.clientId });
      return board;
    }),

  /** Move a board to another workspace (board admins who belong to the target). */
  /**
   * Move a board to another workspace. Board admins can move into any workspace
   * they belong to; site admins can move any board anywhere. Board members keep
   * their access; "workspace" visibility now means the *new* workspace.
   */
  move: protectedProcedure
    .input(z.object({ id: z.string(), workspaceId: z.string() }))
    .mutation(async ({ ctx, input }) => {
      const userId = ctx.session.user.id;
      const siteAdmin = ctx.session.user.isAdmin;
      const board = await ctx.db.board.findUnique({
        where: { id: input.id },
        include: { workspace: { select: { name: true } }, members: { where: { userId } } },
      });
      if (!board) throw new TRPCError({ code: "NOT_FOUND" });
      if (!siteAdmin) {
        if (board.members[0]?.role !== "admin") throw new TRPCError({ code: "FORBIDDEN", message: "Only board admins can move a board." });
        const target = await ctx.db.workspaceMember.findUnique({ where: { workspaceId_userId: { workspaceId: input.workspaceId, userId } } });
        if (!target) throw new TRPCError({ code: "FORBIDDEN", message: "You're not in that workspace." });
      }
      const to = await ctx.db.workspace.findUnique({ where: { id: input.workspaceId }, select: { name: true } });
      if (!to) throw new TRPCError({ code: "NOT_FOUND", message: "That workspace doesn't exist." });
      if (board.workspaceId === input.workspaceId) return;
      await ctx.db.board.update({ where: { id: input.id }, data: { workspaceId: input.workspaceId } });
      await logActivity(ctx.db, {
        boardId: input.id,
        actorId: userId,
        type: "moveBoard",
        data: { name: board.name, from: board.workspace.name, to: to.name },
        origin: ctx.clientId,
      });
    }),

  /** Copy a board's labels and lists, optionally with its open cards. */
  copy: protectedProcedure
    .input(z.object({ id: z.string(), name: z.string().min(1).max(200), workspaceId: z.string(), keepCards: z.boolean() }))
    .mutation(async ({ ctx, input }) => {
      const userId = ctx.session.user.id;
      await requireBoard(ctx.db, userId, input.id, false);
      const ws = await ctx.db.workspaceMember.findUnique({ where: { workspaceId_userId: { workspaceId: input.workspaceId, userId } } });
      if (!ws) throw new TRPCError({ code: "FORBIDDEN", message: "You're not in that workspace." });
      const src = await ctx.db.board.findUniqueOrThrow({
        where: { id: input.id },
        include: {
          labels: true,
          lists: {
            where: { closed: false },
            include: {
              cards: {
                where: { closed: false },
                include: { labels: true, checklists: { include: { items: true } } },
              },
            },
          },
        },
      });
      const board = await ctx.db.$transaction(async (tx) => {
        const b = await tx.board.create({
          data: {
            name: input.name,
            description: src.description,
            workspaceId: input.workspaceId,
            background: src.background,
            bgImage: src.bgImage,
            visibility: src.visibility,
            members: { create: { userId, role: "admin" } },
          },
        });
        const labelMap = new Map<string, string>();
        for (const l of src.labels) {
          const nl = await tx.label.create({ data: { boardId: b.id, name: l.name, color: l.color } });
          labelMap.set(l.id, nl.id);
        }
        for (const l of src.lists) {
          await tx.list.create({
            data: {
              boardId: b.id,
              name: l.name,
              pos: l.pos,
              cards: input.keepCards
                ? {
                    create: l.cards.map((c) => ({
                      title: c.title,
                      description: c.description,
                      pos: c.pos,
                      start: c.start,
                      due: c.due,
                      dueComplete: c.dueComplete,
                      coverColor: c.coverColor,
                      labels: { create: c.labels.map((cl) => ({ labelId: labelMap.get(cl.labelId)! })) },
                      checklists: {
                        create: c.checklists.map((cl) => ({
                          name: cl.name,
                          pos: cl.pos,
                          items: { create: cl.items.map((i) => ({ name: i.name, pos: i.pos, complete: i.complete, due: i.due })) },
                        })),
                      },
                    })),
                  }
                : undefined,
            },
          });
        }
        return b;
      });
      await logActivity(ctx.db, { boardId: board.id, actorId: userId, type: "createBoard", data: { name: board.name } });
      return board;
    }),

  delete: protectedProcedure
    .input(z.object({ id: z.string() }))
    .mutation(async ({ ctx, input }) => {
      const board = await requireBoard(ctx.db, ctx.session.user.id, input.id);
      if (board.members[0]?.role !== "admin") throw new TRPCError({ code: "FORBIDDEN" });
      await ctx.db.board.delete({ where: { id: input.id } });
      touch(input.id);
    }),

  star: protectedProcedure
    .input(z.object({ id: z.string(), starred: z.boolean() }))
    .mutation(async ({ ctx, input }) => {
      const userId = ctx.session.user.id;
      await requireBoard(ctx.db, userId, input.id, false);
      if (input.starred) {
        await ctx.db.boardStar.upsert({
          where: { boardId_userId: { boardId: input.id, userId } },
          create: { boardId: input.id, userId },
          update: {},
        });
      } else {
        await ctx.db.boardStar.deleteMany({ where: { boardId: input.id, userId } });
      }
    }),

  recent: protectedProcedure.query(async ({ ctx }) => {
    const rows = await ctx.db.boardMember.findMany({
      where: { userId: ctx.session.user.id, lastViewed: { not: null }, board: { closed: false } },
      orderBy: { lastViewed: "desc" },
      take: 4,
      include: { board: { include: { stars: { where: { userId: ctx.session.user.id } } } } },
    });
    return rows.map(({ board: { stars, ...b } }) => ({ ...b, starred: stars.length > 0 }));
  }),

  closed: protectedProcedure.query(({ ctx }) =>
    ctx.db.board.findMany({
      where: { closed: true, members: { some: { userId: ctx.session.user.id } } },
      include: { workspace: { select: { name: true } } },
    }),
  ),

  searchUsers: protectedProcedure
    .input(z.object({ q: z.string() }))
    .query(({ ctx, input }) =>
      input.q.trim().length < 2
        ? []
        : ctx.db.user.findMany({
            where: {
              OR: [
                { name: { contains: input.q, mode: "insensitive" } },
                { email: { contains: input.q, mode: "insensitive" } },
                { username: { contains: input.q, mode: "insensitive" } },
              ],
            },
            select: { id: true, name: true, image: true, email: true, isGhost: true },
            take: 8,
          }),
    ),

  addMember: protectedProcedure
    .input(z.object({ id: z.string(), userId: z.string(), role: z.enum(["admin", "normal", "observer"]).default("normal") }))
    .mutation(async ({ ctx, input }) => {
      const board = await requireBoard(ctx.db, ctx.session.user.id, input.id);
      const isAdmin = board.members[0]?.role === "admin";
      const existing = await ctx.db.boardMember.findUnique({
        where: { boardId_userId: { boardId: input.id, userId: input.userId } },
      });
      // Non-admins may invite people as normal members, but not change roles.
      if (!isAdmin && (existing || input.role !== "normal")) throw new TRPCError({ code: "FORBIDDEN" });
      if (existing?.role === "admin" && input.role !== "admin") await assertAnotherAdmin(ctx.db, input.id, input.userId);
      await ctx.db.boardMember.upsert({
        where: { boardId_userId: { boardId: input.id, userId: input.userId } },
        create: { boardId: input.id, userId: input.userId, role: input.role },
        update: { role: input.role },
      });
      await ctx.db.workspaceMember.upsert({
        where: { workspaceId_userId: { workspaceId: board.workspaceId, userId: input.userId } },
        create: { workspaceId: board.workspaceId, userId: input.userId },
        update: {},
      });
      await logActivity(ctx.db, { boardId: input.id, actorId: ctx.session.user.id, type: "addMemberToBoard", data: { userId: input.userId }, origin: ctx.clientId });
    }),

  removeMember: protectedProcedure
    .input(z.object({ id: z.string(), userId: z.string() }))
    .mutation(async ({ ctx, input }) => {
      const board = await requireBoard(ctx.db, ctx.session.user.id, input.id, false);
      const self = input.userId === ctx.session.user.id;
      if (!self && board.members[0]?.role !== "admin") throw new TRPCError({ code: "FORBIDDEN" });
      await assertAnotherAdmin(ctx.db, input.id, input.userId);
      await ctx.db.boardMember.deleteMany({ where: { boardId: input.id, userId: input.userId } });
      await ctx.db.cardMember.deleteMany({ where: { userId: input.userId, card: { list: { boardId: input.id } } } });
      touch(input.id, undefined, ctx.clientId);
    }),

  activity: protectedProcedure
    .input(z.object({ id: z.string(), cursor: z.string().nullish() }))
    .query(async ({ ctx, input }) => {
      await requireBoard(ctx.db, ctx.session.user.id, input.id, false);
      const items = await ctx.db.activity.findMany({
        where: { boardId: input.id },
        orderBy: { createdAt: "desc" },
        take: 31,
        cursor: input.cursor ? { id: input.cursor } : undefined,
        include: {
          actor: { select: { id: true, name: true, image: true } },
          card: { select: { id: true, title: true } },
        },
      });
      const next = items.length > 30 ? items.pop()!.id : null;
      return { items: items.map((a) => ({ ...a, data: JSON.parse(a.data) as Record<string, unknown> })), next };
    }),

  archived: protectedProcedure
    .input(z.object({ id: z.string() }))
    .query(async ({ ctx, input }) => {
      await requireBoard(ctx.db, ctx.session.user.id, input.id, false);
      const [cards, lists] = await Promise.all([
        ctx.db.card.findMany({
          where: { closed: true, list: { boardId: input.id } },
          include: { list: { select: { name: true } } },
          orderBy: { updatedAt: "desc" },
        }),
        ctx.db.list.findMany({ where: { closed: true, boardId: input.id } }),
      ]);
      return { cards, lists };
    }),

  onEvent: protectedProcedure
    .input(z.object({ id: z.string() }))
    .subscription(async function* ({ ctx, input, signal }) {
      await requireBoard(ctx.db, ctx.session.user.id, input.id, false);
      for await (const [event] of on(boardBus, `board:${input.id}`, { signal })) {
        yield event as BoardEvent;
      }
    }),
});

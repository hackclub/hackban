import { randomBytes } from "node:crypto";
import { on } from "node:events";

import { TRPCError } from "@trpc/server";
import { z } from "zod";

import { logActivity, requireBoard, touch } from "~/server/api/access";
import { DEFAULT_LABEL_COLORS, httpsUrl } from "~/server/api/defaults";
import { sequentialKeys } from "~/server/api/pos";
import { memberInput, userForInvite } from "~/server/invite";
import { removeStored, storedKeys } from "~/server/storage";
import { createTRPCRouter, protectedProcedure } from "~/server/api/trpc";
import { type db as Db } from "~/server/db";
import { boardBus, type BoardEvent } from "~/server/realtime";

/** Board backgrounds are a color or gradient, never arbitrary CSS. */
const background = z
  .string()
  .max(200)
  .regex(/^(#[0-9a-fA-F]{3,8}|linear-gradient\([#0-9a-zA-Z%,.\s-]+\))$/, "Invalid background");
const cardFrontInclude = {
  labels: { include: { label: true } },
  members: { include: { user: { select: { id: true, name: true, image: true } } } },
  checklists: { include: { items: { select: { complete: true } } } },
  _count: { select: { comments: true, attachments: true } },
  issues: { select: { id: true, owner: true, repo: true, number: true, state: true, title: true, fetchError: true } },
  // Only unfinished links: the card front shows "Blocked"/"Blocking" until they're done.
  blockedBy: { where: { blocker: { closed: false, dueComplete: false } }, select: { blocker: { select: { title: true } } } },
  blocking: { where: { blocked: { closed: false, dueComplete: false } }, select: { blocked: { select: { title: true } } } },
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
        omit: { inviteToken: false },
        include: {
          workspace: { select: { id: true, name: true } },
          members: {
            include: { user: { select: { id: true, name: true, image: true, username: true, isGhost: true, invitedEmail: true } } },
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
      const { stars, inviteToken, members, ...rest } = board;
      // Board members who aren't in the workspace are "guests".
      const inWorkspace = new Set(
        (
          await ctx.db.workspaceMember.findMany({
            where: { workspaceId: board.workspaceId, userId: { in: members.map((m) => m.userId) } },
            select: { userId: true },
          })
        ).map((m) => m.userId),
      );
      return {
        ...rest,
        members: members.map((m) => ({ ...m, guest: !inWorkspace.has(m.userId) })),
        // The join link is only for people already on the board (otherwise a
        // public/workspace viewer could copy it and make themselves a member).
        inviteToken: access.members[0] ? inviteToken : null,
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
        background: background.default("#0079bf"),
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
      logActivity(ctx.db, { boardId: board.id, actorId: userId, type: "createBoard", data: { name: board.name } });
      return board;
    }),

  update: protectedProcedure
    .input(
      z.object({
        id: z.string(),
        name: z.string().min(1).max(200).optional(),
        description: z.string().max(16384).optional(),
        background: background.optional(),
        bgImage: httpsUrl.nullable().optional(),
        visibility: z.enum(["private", "workspace", "public"]).optional(),
        closed: z.boolean().optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const { id, ...data } = input;
      const access = await requireBoard(ctx.db, ctx.session.user.id, id);
      // Who can see the board, and closing it, are board-admin decisions.
      if ((input.visibility !== undefined || input.closed !== undefined) && access.members[0]?.role !== "admin" && !ctx.session.user.isAdmin) {
        throw new TRPCError({ code: "FORBIDDEN", message: "Only board admins can change visibility or close the board." });
      }
      const board = await ctx.db.board.update({ where: { id }, data });
      const type = input.closed === true ? "closeBoard" : input.closed === false ? "reopenBoard" : input.name ? "renameBoard" : "updateBoard";
      logActivity(ctx.db, { boardId: id, actorId: ctx.session.user.id, type, data: { name: board.name }, origin: ctx.clientId });
      return board;
    }),

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
      logActivity(ctx.db, {
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
      logActivity(ctx.db, { boardId: board.id, actorId: userId, type: "createBoard", data: { name: board.name } });
      return board;
    }),

  delete: protectedProcedure
    .input(z.object({ id: z.string() }))
    .mutation(async ({ ctx, input }) => {
      const board = await requireBoard(ctx.db, ctx.session.user.id, input.id);
      if (board.members[0]?.role !== "admin") throw new TRPCError({ code: "FORBIDDEN" });
      const keys = await storedKeys({ card: { list: { boardId: input.id } } });
      await ctx.db.board.delete({ where: { id: input.id } });
      keys.forEach((k) => void removeStored(k));
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

  /**
   * People picker. Matches names/usernames by substring but emails only
   * exactly, and only site admins get emails back, so this can't be used to
   * enumerate everyone's address.
   */
  searchUsers: protectedProcedure
    .input(z.object({ q: z.string().max(100) }))
    .query(async ({ ctx, input }) => {
      const q = input.q.trim();
      if (q.length < 2) return [];
      const users = await ctx.db.user.findMany({
        where: {
          OR: [
            { name: { contains: q, mode: "insensitive" } },
            { username: { contains: q, mode: "insensitive" } },
            { email: { equals: q, mode: "insensitive" } },
          ],
          // Invited ghosts are named after their email; keep them out of search so it can't reveal who was invited.
          invitedEmail: null,
        },
        select: { id: true, name: true, image: true, email: true, username: true, isGhost: true },
        take: 8,
      });
      const showEmail = ctx.session.user.isAdmin;
      return users.map((u) => ({ ...u, email: showEmail || u.email?.toLowerCase() === q.toLowerCase() ? u.email : null }));
    }),

  addMember: protectedProcedure
    .input(memberInput(z.enum(["admin", "normal", "observer"]).default("normal")))
    .mutation(async ({ ctx, input }) => {
      const board = await requireBoard(ctx.db, ctx.session.user.id, input.id);
      // Inviting needs board membership (not just workspace access to a
      // workspace-visible board); changing roles needs board admin.
      if (!board.members[0]) throw new TRPCError({ code: "FORBIDDEN", message: "Join the board to invite people." });
      const isAdmin = board.members[0].role === "admin";
      const userId = input.userId ?? (await userForInvite(ctx.db, input.email!));
      const existing = await ctx.db.boardMember.findUnique({
        where: { boardId_userId: { boardId: input.id, userId } },
      });
      // Non-admins may invite people as normal members, but not change roles.
      if (!isAdmin && (existing || input.role !== "normal")) throw new TRPCError({ code: "FORBIDDEN" });
      if (existing?.role === "admin" && input.role !== "admin") await assertAnotherAdmin(ctx.db, input.id, userId);
      await ctx.db.boardMember.upsert({
        where: { boardId_userId: { boardId: input.id, userId } },
        create: { boardId: input.id, userId, role: input.role },
        update: { role: input.role },
      });
      // Board-only membership: people added here are guests of this board and
      // are NOT added to the workspace (so they can't see its other boards).
      logActivity(ctx.db, { boardId: input.id, actorId: ctx.session.user.id, type: "addMemberToBoard", data: { userId }, origin: ctx.clientId });
    }),

  // ----- Invite links (board-only guests) -----

  /** Turn the join link on/off, change its role, or reset it. Board admins only. */
  setInviteLink: protectedProcedure
    .input(z.object({ id: z.string(), enabled: z.boolean(), role: z.enum(["normal", "observer"]).optional(), reset: z.boolean().optional() }))
    .mutation(async ({ ctx, input }) => {
      const board = await requireBoard(ctx.db, ctx.session.user.id, input.id);
      if (board.members[0]?.role !== "admin" && !ctx.session.user.isAdmin) {
        throw new TRPCError({ code: "FORBIDDEN", message: "Only board admins can manage the invite link." });
      }
      const current = await ctx.db.board.findUniqueOrThrow({ where: { id: input.id }, select: { inviteToken: true } });
      const inviteToken = !input.enabled ? null : input.reset || !current.inviteToken ? randomBytes(18).toString("base64url") : current.inviteToken;
      const updated = await ctx.db.board.update({
        where: { id: input.id },
        data: { inviteToken, ...(input.role ? { inviteRole: input.role } : {}) },
        select: { inviteToken: true, inviteRole: true },
      });
      touch(input.id, undefined, ctx.clientId);
      return updated;
    }),

  /** What a join link points at (shown before joining). */
  invitePreview: protectedProcedure.input(z.object({ token: z.string().min(16).max(64) })).query(async ({ ctx, input }) => {
    const board = await ctx.db.board.findUnique({
      where: { inviteToken: input.token },
      select: {
        id: true,
        name: true,
        background: true,
        bgImage: true,
        closed: true,
        inviteRole: true,
        workspace: { select: { name: true } },
        members: { where: { userId: ctx.session.user.id }, select: { role: true } },
        _count: { select: { members: true } },
      },
    });
    if (!board || board.closed) throw new TRPCError({ code: "NOT_FOUND", message: "This invite link is invalid or has been turned off." });
    const { members, ...rest } = board;
    return { ...rest, alreadyMember: members.length > 0 };
  }),

  /** Join a board through its link, as a board-only guest. */
  joinByInvite: protectedProcedure.input(z.object({ token: z.string().min(16).max(64) })).mutation(async ({ ctx, input }) => {
    const board = await ctx.db.board.findUnique({ where: { inviteToken: input.token }, select: { id: true, closed: true, inviteRole: true } });
    if (!board || board.closed) throw new TRPCError({ code: "NOT_FOUND", message: "This invite link is invalid or has been turned off." });
    // Existing members keep their role (a link never demotes or promotes).
    await ctx.db.boardMember.upsert({
      where: { boardId_userId: { boardId: board.id, userId: ctx.session.user.id } },
      create: { boardId: board.id, userId: ctx.session.user.id, role: board.inviteRole === "observer" ? "observer" : "normal" },
      update: {},
    });
    logActivity(ctx.db, { boardId: board.id, actorId: ctx.session.user.id, type: "joinBoard" });
    return { boardId: board.id };
  }),

  /** Boards I'm on whose workspace I'm not in, grouped for the home page. */
  guestBoards: protectedProcedure.query(async ({ ctx }) => {
    const userId = ctx.session.user.id;
    const boards = await ctx.db.board.findMany({
      where: { closed: false, members: { some: { userId } }, workspace: { members: { none: { userId } } } },
      orderBy: { name: "asc" },
      select: {
        id: true,
        name: true,
        background: true,
        bgImage: true,
        workspace: { select: { id: true, name: true } },
        stars: { where: { userId }, select: { userId: true } },
      },
    });
    return boards.map(({ stars, ...b }) => ({ ...b, starred: stars.length > 0 }));
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

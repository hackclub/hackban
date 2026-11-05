import { TRPCError } from "@trpc/server";
import { z } from "zod";

import { removeBoardBg, removeStored, storedKeys } from "~/server/storage";
import { createTRPCRouter, protectedProcedure } from "~/server/api/trpc";
import { type db as Db } from "~/server/db";
import { emailDomain, normalizeDomain, upsertAutoJoin } from "~/server/autojoin";
import { memberInput, userForInvite } from "~/server/invite";
import { mergeUsers } from "~/server/import/apply";

/** Versioned URL for a workspace's logo, or null to fall back to its initial. */
export const logoUrl = (w: { id: string; logoKey: string | null }) =>
  w.logoKey ? `/api/workspaces/${w.id}/logo?v=${w.logoKey.slice(0, 8)}` : null;

/** Shared email providers: auto-joining these would pull in strangers. */
const FREE_MAIL = new Set([
  "gmail.com", "googlemail.com", "outlook.com", "hotmail.com", "live.com", "msn.com", "yahoo.com", "icloud.com",
  "me.com", "mac.com", "aol.com", "proton.me", "protonmail.com", "pm.me", "gmx.com", "gmx.net", "mail.com",
  "yandex.com", "zoho.com", "fastmail.com", "hey.com", "tutanota.com", "qq.com", "163.com",
]);

export const workspaceRouter = createTRPCRouter({
  list: protectedProcedure.query(async ({ ctx }) => {
    const userId = ctx.session.user.id;
    let workspaces = await ctx.db.workspace.findMany({
      where: { members: { some: { userId } } },
      orderBy: { createdAt: "asc" },
      include: {
        boards: {
          where: {
            closed: false,
            OR: [
              { members: { some: { userId } } },
              { visibility: { in: ["workspace", "public"] } },
            ],
          },
          orderBy: { name: "asc" },
          include: { stars: { where: { userId } } },
        },
      },
    });
    if (workspaces.length === 0) {
      // First login: give the user a personal workspace, like Trello does.
      await ctx.db.workspace.create({
        data: {
          name: `${ctx.session.user.name?.split(" ")[0] ?? "My"}'s workspace`,
          members: { create: { userId, role: "admin" } },
        },
      });
      workspaces = await ctx.db.workspace.findMany({
        where: { members: { some: { userId } } },
        include: { boards: { include: { stars: { where: { userId } } } } },
      });
    }
    return workspaces.map((w) => ({
      ...w,
      logo: logoUrl(w),
      boards: w.boards.map(({ stars, ...b }) => ({ ...b, starred: stars.length > 0 })),
    }));
  }),

  create: protectedProcedure
    .input(z.object({ name: z.string().min(1).max(100) }))
    .mutation(({ ctx, input }) =>
      ctx.db.workspace.create({
        data: {
          name: input.name,
          members: { create: { userId: ctx.session.user.id, role: "admin" } },
        },
      }),
    ),

  get: protectedProcedure
    .input(z.object({ id: z.string() }))
    .query(async ({ ctx, input }) => {
      const me = await requireWorkspace(ctx.db, ctx.session.user.id, input.id);
      const ws = await ctx.db.workspace.findUniqueOrThrow({
        where: { id: input.id },
        include: {
          members: {
            include: { user: { select: { id: true, name: true, email: true, image: true, isGhost: true, invitedEmail: true } } },
            orderBy: { role: "asc" },
          },
          boards: {
            // Private boards are only listed for their own members.
            where: { OR: [{ visibility: { not: "private" } }, { members: { some: { userId: ctx.session.user.id } } }] },
            orderBy: { name: "asc" },
            select: {
              id: true,
              name: true,
              background: true,
              bgImage: true,
              closed: true,
              visibility: true,
              createdAt: true,
              updatedAt: true,
              _count: { select: { members: true } },
              stars: { where: { userId: ctx.session.user.id }, select: { userId: true } },
            },
          },
        },
      });
      // "Most recently active" = newest activity on the board.
      const last = await ctx.db.activity.groupBy({
        by: ["boardId"],
        where: { boardId: { in: ws.boards.map((b) => b.id) } },
        _max: { createdAt: true },
      });
      const lastById = new Map(last.map((l) => [l.boardId, l._max.createdAt]));
      return {
        ...ws,
        logo: logoUrl(ws),
        boards: ws.boards.map(({ stars, ...b }) => ({ ...b, starred: stars.length > 0, lastActive: lastById.get(b.id) ?? b.updatedAt })),
        myRole: me.role,
      };
    }),

  update: protectedProcedure
    .input(z.object({ id: z.string(), name: z.string().min(1).max(100).optional(), description: z.string().max(2000).optional() }))
    .mutation(async ({ ctx, input }) => {
      await requireWorkspace(ctx.db, ctx.session.user.id, input.id, true);
      const { id, ...data } = input;
      return ctx.db.workspace.update({ where: { id }, data });
    }),

  /** Admins add anyone; members can invite as normal members only. An email adds people who haven't logged in yet. */
  addMember: protectedProcedure
    .input(memberInput(z.enum(["admin", "normal"]).default("normal")))
    .mutation(async ({ ctx, input }) => {
      const me = await requireWorkspace(ctx.db, ctx.session.user.id, input.id);
      const userId = input.userId ?? (await userForInvite(ctx.db, input.email!));
      const existing = await ctx.db.workspaceMember.findUnique({
        where: { workspaceId_userId: { workspaceId: input.id, userId } },
      });
      if (me.role !== "admin" && (existing || input.role !== "normal")) throw new TRPCError({ code: "FORBIDDEN" });
      if (existing?.role === "admin" && input.role !== "admin") await assertAnotherAdmin(ctx.db, input.id, userId);
      await ctx.db.workspaceMember.upsert({
        where: { workspaceId_userId: { workspaceId: input.id, userId } },
        create: { workspaceId: input.id, userId, role: input.role },
        update: { role: input.role },
      });
    }),

  /** Admins remove anyone; anyone can leave. Also drops their board memberships here. */
  /**
   * Link an imported Trello placeholder ("ghost") to a real account: their
   * cards, comments, and board/workspace memberships move over. Trello never
   * shares emails, so this can't happen automatically on login.
   *
   * Merging grants the target everything the ghost had, and the ghost's
   * history comes from an import, so only site admins may do it.
   */
  linkGhost: protectedProcedure
    .input(z.object({ id: z.string(), ghostId: z.string(), userId: z.string() }))
    .mutation(async ({ ctx, input }) => {
      // Site admins only: linking is irreversible and attributes the ghost's
      // (importer-controlled) history to someone else's real account.
      if (!ctx.session.user.isAdmin) throw new TRPCError({ code: "FORBIDDEN", message: "Only site admins can link imported members." });
      const ghost = await ctx.db.user.findUnique({
        where: { id: input.ghostId },
        include: { workspaces: { select: { workspaceId: true } } },
      });
      if (!ghost?.isGhost || !ghost.workspaces.some((w) => w.workspaceId === input.id)) {
        throw new TRPCError({ code: "NOT_FOUND", message: "That imported member isn't in this workspace." });
      }
      const target = await ctx.db.user.findUnique({ where: { id: input.userId } });
      if (!target || target.isGhost) throw new TRPCError({ code: "BAD_REQUEST", message: "Pick someone who has logged in." });
      if (target.trelloId && target.trelloId !== ghost.trelloId) {
        throw new TRPCError({ code: "BAD_REQUEST", message: `${target.name ?? "That account"} is already linked to a different Trello member.` });
      }
      await mergeUsers(ghost.id, target.id);
    }),

  // ----- Auto-join by email domain -----

  autoJoins: protectedProcedure.input(z.object({ id: z.string() })).query(async ({ ctx, input }) => {
    if (!ctx.session.user.isAdmin) await requireWorkspace(ctx.db, ctx.session.user.id, input.id);
    const rules = await ctx.db.workspaceAutoJoin.findMany({
      where: { workspaceId: input.id },
      orderBy: { createdAt: "asc" },
      include: { createdBy: { select: { name: true } } },
    });
    const counts = await Promise.all(
      rules.map((r) =>
        ctx.db.workspaceMember.count({
          where: { workspaceId: input.id, user: { email: { endsWith: `@${r.domain}`, mode: "insensitive" } } },
        }),
      ),
    );
    return rules.map((r, i) => ({ ...r, memberCount: counts[i]! }));
  }),

  /**
   * Workspace admins can only add their own email domain (otherwise anyone
   * could pull e.g. every @hackclub.com account into their workspace). Site
   * admins can add any domain.
   */
  addAutoJoin: protectedProcedure
    .input(z.object({ id: z.string(), domain: z.string(), role: z.enum(["admin", "normal"]).default("normal") }))
    .mutation(async ({ ctx, input }) => {
      if (!ctx.session.user.isAdmin) await requireWorkspace(ctx.db, ctx.session.user.id, input.id, true);
      const domain = normalizeDomain(input.domain);
      if (!ctx.session.user.isAdmin && input.role !== "normal") {
        throw new TRPCError({ code: "FORBIDDEN", message: "Only site admins can auto-join people as admins." });
      }
      if (!ctx.session.user.isAdmin && FREE_MAIL.has(domain)) {
        throw new TRPCError({ code: "FORBIDDEN", message: `@${domain} is a public email provider; ask a site admin.` });
      }
      if (!ctx.session.user.isAdmin && emailDomain(ctx.session.user.email) !== domain) {
        throw new TRPCError({
          code: "FORBIDDEN",
          message: `You can only add your own domain (@${emailDomain(ctx.session.user.email) ?? "?"}). Ask a site admin for others.`,
        });
      }
      return upsertAutoJoin({ workspaceId: input.id, domain, role: input.role, createdById: ctx.session.user.id });
    }),

  removeAutoJoin: protectedProcedure
    .input(z.object({ id: z.string(), ruleId: z.string() }))
    .mutation(async ({ ctx, input }) => {
      if (!ctx.session.user.isAdmin) await requireWorkspace(ctx.db, ctx.session.user.id, input.id, true);
      // Existing members stay; this only stops future auto-joins.
      await ctx.db.workspaceAutoJoin.deleteMany({ where: { id: input.ruleId, workspaceId: input.id } });
    }),

  removeMember: protectedProcedure
    .input(z.object({ id: z.string(), userId: z.string() }))
    .mutation(async ({ ctx, input }) => {
      const me = await requireWorkspace(ctx.db, ctx.session.user.id, input.id);
      if (input.userId !== ctx.session.user.id && me.role !== "admin") throw new TRPCError({ code: "FORBIDDEN" });
      await assertAnotherAdmin(ctx.db, input.id, input.userId);
      await ctx.db.$transaction([
        ctx.db.boardMember.deleteMany({ where: { userId: input.userId, board: { workspaceId: input.id } } }),
        ctx.db.workspaceMember.deleteMany({ where: { workspaceId: input.id, userId: input.userId } }),
      ]);
    }),

  delete: protectedProcedure
    .input(z.object({ id: z.string(), confirmName: z.string() }))
    .mutation(async ({ ctx, input }) => {
      await requireWorkspace(ctx.db, ctx.session.user.id, input.id, true);
      const ws = await ctx.db.workspace.findUniqueOrThrow({ where: { id: input.id } });
      if (ws.name !== input.confirmName) throw new TRPCError({ code: "BAD_REQUEST", message: "Workspace name doesn't match." });
      const keys = await storedKeys({ card: { list: { board: { workspaceId: input.id } } } });
      const bgs = await ctx.db.board.findMany({ where: { workspaceId: input.id }, select: { bgImage: true } });
      await ctx.db.workspace.delete({ where: { id: input.id } });
      bgs.forEach((b) => void removeBoardBg(b.bgImage));
      [...keys, ws.logoKey?.split(":")[0]].forEach((k) => void removeStored(k));
    }),
});

async function requireWorkspace(db: typeof Db, userId: string, workspaceId: string, admin = false) {
  const m = await db.workspaceMember.findUnique({ where: { workspaceId_userId: { workspaceId, userId } } });
  if (!m) throw new TRPCError({ code: "NOT_FOUND" });
  if (admin && m.role !== "admin") throw new TRPCError({ code: "FORBIDDEN" });
  return m;
}

async function assertAnotherAdmin(db: typeof Db, workspaceId: string, leavingUserId: string) {
  const others = await db.workspaceMember.count({ where: { workspaceId, role: "admin", userId: { not: leavingUserId } } });
  if (others === 0) throw new TRPCError({ code: "BAD_REQUEST", message: "A workspace needs at least one admin." });
}

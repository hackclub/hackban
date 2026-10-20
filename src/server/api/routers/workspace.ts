import { TRPCError } from "@trpc/server";
import { z } from "zod";

import { createTRPCRouter, protectedProcedure } from "~/server/api/trpc";
import { type db as Db } from "~/server/db";

/** Versioned URL for a workspace's logo, or null to fall back to its initial. */
export const logoUrl = (w: { id: string; logoKey: string | null }) =>
  w.logoKey ? `/api/workspaces/${w.id}/logo?v=${w.logoKey.slice(0, 8)}` : null;

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
            include: { user: { select: { id: true, name: true, email: true, image: true, isGhost: true } } },
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

  /** Admins add anyone; members can invite as normal members only. */
  addMember: protectedProcedure
    .input(z.object({ id: z.string(), userId: z.string(), role: z.enum(["admin", "normal"]).default("normal") }))
    .mutation(async ({ ctx, input }) => {
      const me = await requireWorkspace(ctx.db, ctx.session.user.id, input.id);
      const existing = await ctx.db.workspaceMember.findUnique({
        where: { workspaceId_userId: { workspaceId: input.id, userId: input.userId } },
      });
      if (me.role !== "admin" && (existing || input.role !== "normal")) throw new TRPCError({ code: "FORBIDDEN" });
      if (existing?.role === "admin" && input.role !== "admin") await assertAnotherAdmin(ctx.db, input.id, input.userId);
      await ctx.db.workspaceMember.upsert({
        where: { workspaceId_userId: { workspaceId: input.id, userId: input.userId } },
        create: { workspaceId: input.id, userId: input.userId, role: input.role },
        update: { role: input.role },
      });
    }),

  /** Admins remove anyone; anyone can leave. Also drops their board memberships here. */
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
      await ctx.db.workspace.delete({ where: { id: input.id } });
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

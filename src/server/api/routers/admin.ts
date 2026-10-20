import { TRPCError } from "@trpc/server";
import { z } from "zod";

import { touch } from "~/server/api/access";
import { adminProcedure, createTRPCRouter } from "~/server/api/trpc";
import { adminEmails } from "~/server/auth/config";

const q = z.object({ q: z.string().default("") });

export const adminRouter = createTRPCRouter({
  stats: adminProcedure.query(async ({ ctx }) => {
    const weekAgo = new Date(Date.now() - 7 * 864e5);
    const [users, ghosts, workspaces, boards, cards, comments, attachments, activeUsers, imports] = await Promise.all([
      ctx.db.user.count({ where: { isGhost: false } }),
      ctx.db.user.count({ where: { isGhost: true } }),
      ctx.db.workspace.count(),
      ctx.db.board.count(),
      ctx.db.card.count(),
      ctx.db.comment.count(),
      ctx.db.attachment.aggregate({ _count: true, _sum: { size: true }, where: { isUpload: true } }),
      ctx.db.activity.groupBy({ by: ["actorId"], where: { createdAt: { gte: weekAgo } } }),
      ctx.db.trelloImport.count(),
    ]);
    return {
      users,
      ghosts,
      workspaces,
      boards,
      cards,
      comments,
      uploads: attachments._count,
      uploadBytes: attachments._sum.size ?? 0,
      activeUsers7d: activeUsers.length,
      imports,
    };
  }),

  users: adminProcedure.input(q).query(({ ctx, input }) =>
    ctx.db.user.findMany({
      where: input.q ? { OR: [{ name: { contains: input.q, mode: "insensitive" } }, { email: { contains: input.q, mode: "insensitive" } }] } : undefined,
      orderBy: [{ isAdmin: "desc" }, { createdAt: "desc" }],
      take: 200,
      select: {
        id: true,
        name: true,
        email: true,
        image: true,
        isAdmin: true,
        isGhost: true,
        createdAt: true,
        _count: { select: { boards: true, workspaces: true, comments: true } },
      },
    }),
  ),

  setAdmin: adminProcedure
    .input(z.object({ userId: z.string(), isAdmin: z.boolean() }))
    .mutation(async ({ ctx, input }) => {
      if (!input.isAdmin) {
        if (input.userId === ctx.session.user.id) {
          throw new TRPCError({ code: "BAD_REQUEST", message: "You can't remove your own admin access." });
        }
        const u = await ctx.db.user.findUniqueOrThrow({ where: { id: input.userId } });
        if (u.email && adminEmails().has(u.email.toLowerCase())) {
          throw new TRPCError({ code: "BAD_REQUEST", message: "This person is an admin via ADMIN_EMAILS; remove them there." });
        }
      }
      await ctx.db.user.update({ where: { id: input.userId }, data: { isAdmin: input.isAdmin } });
    }),

  /** Signs a user out everywhere. */
  revokeSessions: adminProcedure.input(z.object({ userId: z.string() })).mutation(({ ctx, input }) =>
    ctx.db.session.deleteMany({ where: { userId: input.userId } }),
  ),

  deleteUser: adminProcedure.input(z.object({ userId: z.string() })).mutation(async ({ ctx, input }) => {
    if (input.userId === ctx.session.user.id) throw new TRPCError({ code: "BAD_REQUEST", message: "You can't delete yourself." });
    await ctx.db.user.delete({ where: { id: input.userId } });
  }),

  boards: adminProcedure.input(q).query(({ ctx, input }) =>
    ctx.db.board.findMany({
      where: input.q ? { name: { contains: input.q, mode: "insensitive" } } : undefined,
      orderBy: { updatedAt: "desc" },
      take: 200,
      select: {
        id: true,
        name: true,
        background: true,
        bgImage: true,
        closed: true,
        visibility: true,
        updatedAt: true,
        trelloId: true,
        workspace: { select: { id: true, name: true } },
        members: { where: { userId: ctx.session.user.id }, select: { role: true } },
        _count: { select: { members: true, lists: true } },
      },
    }),
  ),

  /** Add yourself as a board admin, e.g. to rescue a board whose admins left. */
  joinBoard: adminProcedure.input(z.object({ boardId: z.string() })).mutation(async ({ ctx, input }) => {
    const board = await ctx.db.board.findUniqueOrThrow({ where: { id: input.boardId } });
    const userId = ctx.session.user.id;
    await ctx.db.boardMember.upsert({
      where: { boardId_userId: { boardId: board.id, userId } },
      create: { boardId: board.id, userId, role: "admin" },
      update: { role: "admin" },
    });
    await ctx.db.workspaceMember.upsert({
      where: { workspaceId_userId: { workspaceId: board.workspaceId, userId } },
      create: { workspaceId: board.workspaceId, userId },
      update: {},
    });
    touch(board.id);
  }),

  deleteBoard: adminProcedure.input(z.object({ boardId: z.string() })).mutation(async ({ ctx, input }) => {
    await ctx.db.board.delete({ where: { id: input.boardId } });
    touch(input.boardId);
  }),

  workspaces: adminProcedure.input(q).query(({ ctx, input }) =>
    ctx.db.workspace.findMany({
      where: input.q ? { name: { contains: input.q, mode: "insensitive" } } : undefined,
      orderBy: { createdAt: "desc" },
      take: 200,
      select: {
        id: true,
        name: true,
        logoKey: true,
        createdAt: true,
        members: { where: { userId: ctx.session.user.id }, select: { role: true } },
        _count: { select: { members: true, boards: true } },
      },
    }),
  ),

  joinWorkspace: adminProcedure.input(z.object({ workspaceId: z.string() })).mutation(({ ctx, input }) =>
    ctx.db.workspaceMember.upsert({
      where: { workspaceId_userId: { workspaceId: input.workspaceId, userId: ctx.session.user.id } },
      create: { workspaceId: input.workspaceId, userId: ctx.session.user.id, role: "admin" },
      update: { role: "admin" },
    }),
  ),

  imports: adminProcedure.query(async ({ ctx }) => {
    const rows = await ctx.db.trelloImport.findMany({
      orderBy: { createdAt: "desc" },
      take: 50,
      include: { user: { select: { name: true, image: true } } },
    });
    return rows.map((r) => ({ ...r, log: JSON.parse(r.log) as string[], result: JSON.parse(r.result) as unknown }));
  }),
});

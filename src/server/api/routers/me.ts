import { z } from "zod";

import { env } from "~/env";

import { createTRPCRouter, protectedProcedure } from "~/server/api/trpc";

export const meRouter = createTRPCRouter({
  profile: protectedProcedure.query(({ ctx }) =>
    ctx.db.user.findUniqueOrThrow({
      where: { id: ctx.session.user.id },
      select: { id: true, name: true, email: true, image: true, avatarKey: true, username: true, trelloId: true, isAdmin: true, createdAt: true },
    }),
  ),

  update: protectedProcedure
    .input(
      z.object({
        name: z.string().trim().min(1).max(100).optional(),
        username: z
          .string()
          .trim()
          .regex(/^[a-z0-9_]{2,32}$/, "2–32 lowercase letters, numbers or underscores")
          .nullable()
          .optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      try {
        return await ctx.db.user.update({ where: { id: ctx.session.user.id }, data: input });
      } catch {
        throw new Error("That username is taken.");
      }
    }),

  activity: protectedProcedure.input(z.object({ cursor: z.string().nullish() })).query(async ({ ctx, input }) => {
    const items = await ctx.db.activity.findMany({
      where: { actorId: ctx.session.user.id },
      orderBy: { createdAt: "desc" },
      take: 31,
      cursor: input.cursor ? { id: input.cursor } : undefined,
      include: {
        actor: { select: { id: true, name: true, image: true } },
        card: { select: { id: true, title: true } },
        board: { select: { id: true, name: true } },
      },
    });
    const next = items.length > 30 ? items.pop()!.id : null;
    return { items: items.map((a) => ({ ...a, data: JSON.parse(a.data) as Record<string, unknown> })), next };
  }),

  /** Open cards assigned to me on boards I can still see. */
  cards: protectedProcedure.query(({ ctx }) =>
    ctx.db.card.findMany({
      where: {
        closed: false,
        members: { some: { userId: ctx.session.user.id } },
        list: { closed: false, board: { closed: false, members: { some: { userId: ctx.session.user.id } } } },
      },
      orderBy: [{ due: "asc" }, { updatedAt: "desc" }],
      take: 200,
      include: {
        list: { select: { name: true, board: { select: { id: true, name: true, background: true, bgImage: true } } } },
        labels: { include: { label: true } },
      },
    }),
  ),

  /** Apps connected over MCP that still hold a live refresh token. */
  apps: protectedProcedure.query(async ({ ctx }) => {
    const rows = await ctx.db.oAuthToken.findMany({
      where: { userId: ctx.session.user.id, kind: "refresh", usedAt: null, expiresAt: { gt: new Date() } },
      distinct: ["clientId"],
      orderBy: { createdAt: "desc" },
      select: { createdAt: true, client: { select: { id: true, name: true } } },
    });
    return rows.map((r) => ({ ...r.client, lastActive: r.createdAt }));
  }),

  revokeApp: protectedProcedure.input(z.object({ id: z.string() })).mutation(({ ctx, input }) =>
    ctx.db.oAuthToken.deleteMany({ where: { userId: ctx.session.user.id, clientId: input.id } }),
  ),

  /** The user's connected GitHub account, if any, and whether connecting is possible on this server. */
  github: protectedProcedure.query(async ({ ctx }) => {
    const conn = await ctx.db.gitHubConnection.findUnique({ where: { userId: ctx.session.user.id }, select: { login: true, createdAt: true } });
    return { available: !!(env.GITHUB_CLIENT_ID && env.GITHUB_CLIENT_SECRET), connection: conn };
  }),

  disconnectGithub: protectedProcedure.mutation(({ ctx }) =>
    ctx.db.gitHubConnection.deleteMany({ where: { userId: ctx.session.user.id } }),
  ),
});

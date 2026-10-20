import { z } from "zod";

import { createTRPCRouter, protectedProcedure } from "~/server/api/trpc";

export const notificationRouter = createTRPCRouter({
  list: protectedProcedure.query(async ({ ctx }) => {
    const rows = await ctx.db.notification.findMany({
      where: { userId: ctx.session.user.id },
      orderBy: { createdAt: "desc" },
      take: 50,
    });
    return rows.map((n) => ({ ...n, data: JSON.parse(n.data) as Record<string, string> }));
  }),
  markAllRead: protectedProcedure.mutation(({ ctx }) =>
    ctx.db.notification.updateMany({
      where: { userId: ctx.session.user.id, read: false },
      data: { read: true },
    }),
  ),
});

export const searchRouter = createTRPCRouter({
  query: protectedProcedure
    .input(z.object({ q: z.string() }))
    .query(async ({ ctx, input }) => {
      const q = input.q.trim();
      if (q.length < 2) return { boards: [], cards: [] };
      const userId = ctx.session.user.id;
      const visible = {
        OR: [
          { members: { some: { userId } } },
          { visibility: "workspace", workspace: { members: { some: { userId } } } },
        ],
      };
      const [boards, cards] = await Promise.all([
        ctx.db.board.findMany({ where: { ...visible, name: { contains: q, mode: "insensitive" } }, take: 6 }),
        ctx.db.card.findMany({
          where: {
            list: { board: visible },
            OR: [{ title: { contains: q, mode: "insensitive" } }, { description: { contains: q, mode: "insensitive" } }],
          },
          include: { list: { select: { name: true, board: { select: { id: true, name: true } } } } },
          take: 12,
        }),
      ]);
      return { boards, cards };
    }),
});

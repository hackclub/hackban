import { z } from "zod";

import { createTRPCRouter, protectedProcedure } from "~/server/api/trpc";

export const meRouter = createTRPCRouter({
  profile: protectedProcedure.query(({ ctx }) =>
    ctx.db.user.findUniqueOrThrow({
      where: { id: ctx.session.user.id },
      select: { id: true, name: true, email: true, image: true, username: true, trelloId: true, createdAt: true },
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
});

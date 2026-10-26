import { z } from "zod";

import { type db as Db } from "~/server/db";

/** Add by account, or by email for someone who may not have logged in yet. */
export const memberInput = <R extends z.ZodTypeAny>(role: R) =>
  z
    .object({
      id: z.string(),
      userId: z.string().optional(),
      email: z.string().trim().toLowerCase().email().max(254).optional(),
      role,
    })
    .refine((i) => !i.userId !== !i.email, "Give either a user or an email.");

/**
 * The user to add for an email invite: whoever has logged in with it, or else
 * an invited ghost (named after the email's local part, so boards never show
 * the address) that becomes them on first login.
 */
export async function userForInvite(db: typeof Db, email: string) {
  const e = email.trim().toLowerCase();
  const real = await db.user.findFirst({
    where: { email: { equals: e, mode: "insensitive" }, isGhost: false },
    select: { id: true },
  });
  if (real) return real.id;
  const ghost = await db.user.upsert({
    where: { invitedEmail: e },
    create: { name: e.split("@")[0], invitedEmail: e, isGhost: true },
    update: {},
    select: { id: true },
  });
  return ghost.id;
}

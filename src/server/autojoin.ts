import { TRPCError } from "@trpc/server";

import { db } from "~/server/db";
import { mergeUsers } from "~/server/import/apply";

const DOMAIN_RE = /^(?=.{3,253}$)([a-z0-9]([a-z0-9-]*[a-z0-9])?\.)+[a-z]{2,}$/;

/** "@HackClub.com " -> "hackclub.com"; throws on anything that isn't a domain. */
export function normalizeDomain(input: string) {
  const d = input.trim().toLowerCase().replace(/^@/, "");
  if (!DOMAIN_RE.test(d)) throw new TRPCError({ code: "BAD_REQUEST", message: `"${input}" isn't a valid email domain.` });
  return d;
}

export function emailDomain(email: string | null | undefined) {
  const at = email?.lastIndexOf("@") ?? -1;
  return at > 0 ? email!.slice(at + 1).toLowerCase() : null;
}

/** Called on every login: join any workspaces with a rule for this user's email domain. */
export async function applyAutoJoinForUser(userId: string, email: string | null | undefined) {
  const domain = emailDomain(email);
  if (!domain) return;
  const rules = await db.workspaceAutoJoin.findMany({ where: { domain } });
  for (const r of rules) {
    // Never change the role of someone who's already a member.
    await db.workspaceMember.upsert({
      where: { workspaceId_userId: { workspaceId: r.workspaceId, userId } },
      create: { workspaceId: r.workspaceId, userId, role: r.role },
      update: {},
    });
  }
}

/** Called on every login: take over the ghost someone invited this email as. */
export async function claimInvite(userId: string, email: string | null | undefined) {
  if (!email) return;
  const ghost = await db.user.findUnique({ where: { invitedEmail: email.toLowerCase() }, select: { id: true } });
  if (ghost && ghost.id !== userId) await mergeUsers(ghost.id, userId);
}

/** Backfill a new rule: add everyone who already has an account on the domain. Returns how many joined. */
export async function applyRuleToExistingUsers(rule: { workspaceId: string; domain: string; role: string }) {
  const users = await db.user.findMany({
    where: {
      isGhost: false,
      email: { endsWith: `@${rule.domain}`, mode: "insensitive" },
      workspaces: { none: { workspaceId: rule.workspaceId } },
    },
    select: { id: true },
  });
  if (users.length) {
    await db.workspaceMember.createMany({
      data: users.map((u) => ({ workspaceId: rule.workspaceId, userId: u.id, role: rule.role })),
      skipDuplicates: true,
    });
  }
  return users.length;
}

/** Create (or update the role of) a rule and backfill existing users. */
export async function upsertAutoJoin(opts: { workspaceId: string; domain: string; role: "admin" | "normal"; createdById: string }) {
  const domain = normalizeDomain(opts.domain);
  const rule = await db.workspaceAutoJoin.upsert({
    where: { workspaceId_domain: { workspaceId: opts.workspaceId, domain } },
    create: { workspaceId: opts.workspaceId, domain, role: opts.role, createdById: opts.createdById },
    update: { role: opts.role },
  });
  const added = await applyRuleToExistingUsers(rule);
  return { rule, added };
}

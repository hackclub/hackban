import { createHmac, timingSafeEqual } from "node:crypto";

import { env } from "~/env";
import { db } from "~/server/db";
import { applyIssueState, stateFromPayload, type GitHubIssuePayload } from "~/server/github";

/**
 * GitHub "issues" webhook: pushes state changes to tracked issues the moment
 * they happen, instead of waiting for the next poll. Point a repo or org
 * webhook here (content type JSON) with GITHUB_WEBHOOK_SECRET as its secret.
 */
export async function POST(req: Request) {
  if (!env.GITHUB_WEBHOOK_SECRET) return new Response("Webhook not configured", { status: 404 });
  const body = await req.text();
  const sig = req.headers.get("x-hub-signature-256") ?? "";
  const expected = `sha256=${createHmac("sha256", env.GITHUB_WEBHOOK_SECRET).update(body).digest("hex")}`;
  if (sig.length !== expected.length || !timingSafeEqual(Buffer.from(sig), Buffer.from(expected))) {
    return new Response("Bad signature", { status: 401 });
  }
  if (req.headers.get("x-github-event") !== "issues") return new Response("Ignored", { status: 202 });
  const event = JSON.parse(body) as {
    action: string;
    issue: GitHubIssuePayload & { number: number };
    repository: { name: string; owner: { login: string } };
    sender?: { login?: string };
  };
  // Only rows whose last fetch succeeded: a webhook mustn't reveal an issue the linker couldn't read.
  const tracked = await db.gitHubIssue.findMany({
    where: { owner: event.repository.owner.login.toLowerCase(), repo: event.repository.name.toLowerCase(), number: event.issue.number, fetchError: null },
    select: { id: true },
  });
  if (event.action === "deleted" || event.action === "transferred") {
    await db.gitHubIssue.deleteMany({ where: { id: { in: tracked.map((t) => t.id) } } });
    return new Response("OK");
  }
  const state = stateFromPayload(event.issue, event.action === "closed" ? event.sender?.login : undefined);
  for (const t of tracked) await applyIssueState(db, t.id, state);
  return new Response("OK");
}

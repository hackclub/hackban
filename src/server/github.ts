import { env } from "~/env";
import { logActivity, requireBoard, touch } from "~/server/api/access";
import { type db as Db } from "~/server/db";

type DB = typeof Db;

/** Cookie carrying the OAuth `state` while a user connects their GitHub account. */
export const STATE_COOKIE = "hackban.github_state";

export type IssueRef = { owner: string; repo: string; number: number };

/** `https://github.com/owner/repo/issues/123` (any query/fragment, optional www) → its parts; anything else → null. */
export function parseIssueUrl(url: string): IssueRef | null {
  const m = /^https?:\/\/(?:www\.)?github\.com\/([\w.-]+)\/([\w.-]+)\/issues\/(\d+)\/?(?:[?#].*)?$/i.exec(url.trim());
  if (!m) return null;
  const number = Number(m[3]);
  if (!Number.isSafeInteger(number) || number < 1) return null;
  return { owner: m[1]!, repo: m[2]!, number };
}

export const issueUrl = (i: IssueRef) => `https://github.com/${i.owner}/${i.repo}/issues/${i.number}`;
export const issueLabel = (i: IssueRef) => `${i.owner}/${i.repo}#${i.number}`;

export type IssueState = {
  title: string;
  state: "open" | "closed";
  stateReason: string | null;
  closedBy: string | null;
  closedAt: Date | null;
};

/** The shape GitHub's REST API and webhook payloads share for an issue. */
export type GitHubIssuePayload = {
  title?: string;
  state?: string;
  state_reason?: string | null;
  closed_at?: string | null;
  closed_by?: { login?: string } | null;
  pull_request?: unknown;
};

export function stateFromPayload(p: GitHubIssuePayload, closedBy?: string | null): IssueState {
  return {
    title: p.title ?? "",
    state: p.state === "closed" ? "closed" : "open",
    stateReason: p.state_reason ?? null,
    closedBy: closedBy ?? p.closed_by?.login ?? null,
    closedAt: p.closed_at ? new Date(p.closed_at) : null,
  };
}

/**
 * Fetch an issue as the user who linked it when they've connected GitHub (so
 * private repos work), otherwise with the shared token or anonymously. A
 * revoked user token is forgotten and the fetch retried without it.
 *
 * `boardId` guards against a confused deputy: once the linker can no longer
 * read the card's board, their token stops feeding it private issue data.
 */
export async function fetchIssueAs(db: DB, ref: IssueRef, userId: string | null, etag?: string | null, boardId?: string) {
  const conn = userId ? await db.gitHubConnection.findUnique({ where: { userId } }) : null;
  if (!conn) return fetchIssue(ref, etag);
  if (boardId && !(await requireBoard(db, conn.userId, boardId, false).then(() => true, () => false))) return fetchIssue(ref, etag);
  try {
    return await fetchIssue(ref, etag, conn.accessToken);
  } catch (e) {
    if (!(e instanceof GitHubAuthError)) throw e;
    console.error(`[github] token for ${conn.login} was revoked; disconnecting`);
    await db.gitHubConnection.deleteMany({ where: { userId: conn.userId } });
    return fetchIssue(ref, etag);
  }
}

// Set when GitHub says we're out of requests; nothing is fetched until it passes.
const rl = globalThis as unknown as { githubPausedUntil?: number };

/**
 * Fetch an issue. Returns `"unchanged"` when the ETag still matches (free: a
 * 304 doesn't count against the rate limit), `null` when it's gone or isn't
 * an issue (pull requests share the endpoint), and throws on other failures.
 */
export class GitHubAuthError extends Error {}

export async function fetchIssue(ref: IssueRef, etag?: string | null, token: string | null = env.GITHUB_TOKEN ?? null): Promise<{ state: IssueState; etag: string | null } | "unchanged" | null> {
  // User tokens have their own rate limit; only the shared one pauses.
  const shared = token === (env.GITHUB_TOKEN ?? null);
  if (shared && rl.githubPausedUntil && Date.now() < rl.githubPausedUntil) throw new Error("GitHub rate limit reached; waiting");
  const headers: Record<string, string> = { Accept: "application/vnd.github+json", "User-Agent": "hackban" };
  if (token) headers.Authorization = `Bearer ${token}`;
  if (etag) headers["If-None-Match"] = etag;
  const res = await fetch(`https://api.github.com/repos/${ref.owner}/${ref.repo}/issues/${ref.number}`, { headers });
  if (res.status === 304) return "unchanged";
  if (res.status === 401) throw new GitHubAuthError("GitHub rejected the token");
  if (res.status === 404 || res.status === 410) return null;
  if (shared && (res.status === 403 || res.status === 429) && res.headers.get("x-ratelimit-remaining") === "0") {
    const reset = Number(res.headers.get("x-ratelimit-reset")) * 1000;
    rl.githubPausedUntil = Number.isFinite(reset) && reset > Date.now() ? reset : Date.now() + 10 * 60_000;
    throw new Error("GitHub rate limit reached");
  }
  if (!res.ok) throw new Error(`GitHub responded ${res.status}`);
  const body = (await res.json()) as GitHubIssuePayload;
  if (body.pull_request) return null;
  return { state: stateFromPayload(body), etag: res.headers.get("etag") };
}

/**
 * What to do to a card after one of its issues changed state. A card completes
 * when its last open issue closes. A card that an issue completed reopens when
 * a tracked issue is open again; one completed by hand is left alone.
 */
export function cardTransition(
  card: { dueComplete: boolean; closed: boolean },
  issues: { state: string; completedCardAt: Date | null }[],
): "complete" | "reopen" | null {
  if (card.closed || issues.length === 0) return null;
  const allClosed = issues.every((i) => i.state === "closed");
  if (allClosed && !card.dueComplete) return "complete";
  if (!allClosed && card.dueComplete && issues.some((i) => i.completedCardAt)) return "reopen";
  return null;
}

/**
 * Record an issue's current state and complete/reopen its card accordingly.
 * Returns true when the card changed.
 */
export async function applyIssueState(db: DB, issueId: string, next: IssueState, etag?: string | null) {
  const prev = await db.gitHubIssue.findUnique({ where: { id: issueId } });
  if (!prev) return false;
  const issue = await db.gitHubIssue.update({
    where: { id: issueId },
    data: {
      title: next.title,
      state: next.state,
      stateReason: next.stateReason,
      closedBy: next.closedBy,
      closedAt: next.closedAt,
      checkedAt: new Date(),
      fetchError: null,
      ...(etag !== undefined ? { etag } : {}),
    },
    include: { card: { include: { issues: true, list: { select: { boardId: true } } } } },
  });
  if (prev.state === next.state) return false;
  const { card } = issue;
  const action = cardTransition(card, card.issues);
  if (!action) {
    touch(card.list.boardId, card.id);
    return false;
  }
  const complete = action === "complete";
  await db.card.update({ where: { id: card.id }, data: { dueComplete: complete } });
  if (complete) await db.gitHubIssue.update({ where: { id: issue.id }, data: { completedCardAt: new Date() } });
  else await db.gitHubIssue.updateMany({ where: { cardId: card.id }, data: { completedCardAt: null } });
  // Activity needs an actor: the person who linked the issue stands in for GitHub.
  const actorId = issue.addedById ?? card.issues.find((i) => i.addedById)?.addedById;
  if (actorId) {
    logActivity(db, {
      boardId: card.list.boardId,
      cardId: card.id,
      actorId,
      type: complete ? "githubIssueClosed" : "githubIssueReopened",
      data: { title: card.title, issue: issueLabel(issue), closedBy: next.closedBy },
    });
  } else {
    touch(card.list.boardId, card.id);
  }
  return true;
}

/**
 * Fetch one tracked issue and apply what GitHub says. An issue that can't be
 * read (deleted, private, or really a pull request) stays tracked with
 * `fetchError` set so the card can say so.
 */
export async function syncIssue(db: DB, issue: { id: string; owner: string; repo: string; number: number; etag: string | null; addedById: string | null; cardId: string }) {
  const card = await db.card.findUnique({ where: { id: issue.cardId }, select: { list: { select: { boardId: true } } } });
  if (!card) return;
  const res = await fetchIssueAs(db, issue, issue.addedById, issue.etag, card.list.boardId);
  if (res === "unchanged") {
    await db.gitHubIssue.update({ where: { id: issue.id }, data: { checkedAt: new Date(), fetchError: null } });
    return;
  }
  if (res === null) {
    await db.gitHubIssue.update({ where: { id: issue.id }, data: { checkedAt: new Date(), fetchError: "not_found", etag: null } });
    return;
  }
  await applyIssueState(db, issue.id, res.state, res.etag);
}

/** Start tracking an issue on a card. Fetches its title and state right away (best effort). */
export async function trackIssue(db: DB, cardId: string, ref: IssueRef, userId: string | null) {
  const issue = await db.gitHubIssue.upsert({
    where: { cardId_owner_repo_number: { cardId, ...ref } },
    update: {},
    create: { cardId, ...ref, addedById: userId },
  });
  try {
    const res = await fetchIssueAs(db, ref, userId);
    if (res === null) {
      await db.gitHubIssue.update({ where: { id: issue.id }, data: { checkedAt: new Date(), fetchError: "not_found" } });
    } else if (res !== "unchanged") {
      await db.gitHubIssue.update({
        where: { id: issue.id },
        data: { title: res.state.title, state: res.state.state, stateReason: res.state.stateReason, closedBy: res.state.closedBy, closedAt: res.state.closedAt, etag: res.etag, checkedAt: new Date(), fetchError: null },
      });
    }
  } catch (e) {
    console.error("[github] initial fetch failed", issueLabel(ref), e);
  }
  return issue;
}

// Open issues are checked often (ETags make unchanged ones free); closed and
// unreadable ones rarely, to notice reopens and newly granted access.
const OPEN_EVERY = 2 * 60_000;
const CLOSED_EVERY = 60 * 60_000;
const BATCH = 50;

/** One polling pass over tracked issues that are due a check. */
export async function syncDueIssues(db: DB) {
  const now = Date.now();
  const due = await db.gitHubIssue.findMany({
    where: {
      OR: [
        { state: "open", fetchError: null, OR: [{ checkedAt: null }, { checkedAt: { lt: new Date(now - OPEN_EVERY) } }] },
        { OR: [{ state: "closed" }, { fetchError: { not: null } }], AND: [{ OR: [{ checkedAt: null }, { checkedAt: { lt: new Date(now - CLOSED_EVERY) } }] }] },
      ],
    },
    orderBy: { checkedAt: { sort: "asc", nulls: "first" } },
    take: BATCH,
  });
  for (const issue of due) {
    try {
      await syncIssue(db, issue);
    } catch (e) {
      // Rate limited or GitHub is down: stop this pass and try again next tick.
      console.error("[github] sync failed", issueLabel(issue), (e as Error).message);
      break;
    }
  }
}

const sched = globalThis as unknown as { githubPoller?: ReturnType<typeof setInterval> };

/** Poll tracked issues in the background. Idempotent across dev reloads. */
export function startIssuePoller(db: DB) {
  if (sched.githubPoller) return;
  const tick = () => void syncDueIssues(db).catch((e: unknown) => console.error("[github] poll failed", e));
  sched.githubPoller = setInterval(tick, 60_000);
  sched.githubPoller.unref?.();
  setTimeout(tick, 5_000).unref?.();
}

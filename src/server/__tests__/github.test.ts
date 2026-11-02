import assert from "node:assert/strict";
import { test } from "bun:test";

import { cardTransition, parseIssueUrl, stateFromPayload } from "~/server/github";

test("parses GitHub issue links and nothing else", () => {
  assert.deepEqual(parseIssueUrl("https://github.com/hackclub/hackban/issues/42"), { owner: "hackclub", repo: "hackban", number: 42 });
  assert.deepEqual(parseIssueUrl("https://github.com/HackClub/HackBan/issues/42"), { owner: "hackclub", repo: "hackban", number: 42 }, "case folded");
  assert.deepEqual(parseIssueUrl("http://www.github.com/a-b/c.d/issues/7/"), { owner: "a-b", repo: "c.d", number: 7 });
  assert.deepEqual(parseIssueUrl(" https://github.com/o/r/issues/3#issuecomment-99 "), { owner: "o", repo: "r", number: 3 });
  assert.deepEqual(parseIssueUrl("https://github.com/o/r/issues/3?x=1"), { owner: "o", repo: "r", number: 3 });
  for (const bad of [
    "https://github.com/o/r/pull/3",
    "https://github.com/o/r/issues",
    "https://github.com/o/r/issues/0",
    "https://gitlab.com/o/r/issues/3",
    "https://github.com/o/r/issues/3/extra/path",
    "not a url",
  ]) assert.equal(parseIssueUrl(bad), null, bad);
});

test("webhook and REST payloads normalise the same way", () => {
  const closed = stateFromPayload({ title: "Fix it", state: "closed", state_reason: "completed", closed_at: "2026-11-01T10:00:00Z", closed_by: { login: "octo" } });
  assert.equal(closed.state, "closed");
  assert.equal(closed.closedBy, "octo");
  assert.equal(closed.closedAt?.toISOString(), "2026-11-01T10:00:00.000Z");
  assert.equal(stateFromPayload({ state: "closed" }, "sender").closedBy, "sender");
  assert.equal(stateFromPayload({ state: "weird" }).state, "open");
});

test("a card completes when its last open issue closes, and reopens only if an issue completed it", () => {
  const open = { state: "open", completedCardAt: null };
  const closed = { state: "closed", completedCardAt: null };
  const closer = { state: "closed", completedCardAt: new Date() };
  const todo = { dueComplete: false, closed: false };
  const done = { dueComplete: true, closed: false };
  assert.equal(cardTransition(todo, [closed]), "complete");
  assert.equal(cardTransition(todo, [closed, open]), null);
  assert.equal(cardTransition(done, [closed]), null);
  assert.equal(cardTransition(done, [open]), null, "completed by hand stays complete");
  assert.equal(cardTransition(done, [closer, open]), "reopen", "issue-completed cards reopen while any issue is open");
  assert.equal(cardTransition(done, [{ state: "open", completedCardAt: new Date() }]), "reopen");
  assert.equal(cardTransition({ dueComplete: false, closed: true }, [closed]), null, "archived cards are left alone");
  assert.equal(cardTransition(todo, []), null);
  assert.equal(cardTransition({ ...todo, recurrence: "weekly" }, [closed]), null, "repeating cards are left alone");
});

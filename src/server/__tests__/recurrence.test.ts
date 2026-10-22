import assert from "node:assert/strict";
import { test } from "bun:test";

import { nextDue } from "~/server/recurrence";

test("monthly keeps the 31st after a short month", () => {
  const jan31 = new Date("2026-01-31T17:00:00Z");
  const feb = nextDue(jan31, "monthly", jan31);
  assert.equal(feb.toISOString(), "2026-02-28T17:00:00.000Z");
  assert.equal(nextDue(jan31, "monthly", feb).toISOString(), "2026-03-31T17:00:00.000Z");
});

test("weekdays uses the user's time zone, not UTC", () => {
  // Thursday 18:00 in Los Angeles (PDT, offset 420) = Friday 01:00 UTC.
  const thu = new Date("2026-10-23T01:00:00Z");
  // Next is Friday 18:00 PDT, even though that's Saturday in UTC.
  assert.equal(nextDue(thu, "weekdays", thu, 420).toISOString(), "2026-10-24T01:00:00.000Z");
  // Friday -> Monday.
  const fri = new Date("2026-10-24T01:00:00Z");
  assert.equal(nextDue(fri, "weekdays", fri, 420).toISOString(), "2026-10-27T01:00:00.000Z");
});

test("completed late lands after now", () => {
  const due = new Date("2026-01-01T00:00:00Z");
  const now = new Date("2026-01-10T12:00:00Z");
  assert.equal(nextDue(due, "daily", now).toISOString(), "2026-01-11T00:00:00.000Z");
});

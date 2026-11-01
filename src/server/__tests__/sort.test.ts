import assert from "node:assert/strict";
import { test } from "bun:test";

import { SORTS, sortCards, type CardData } from "~/app/_components/board/types";

const card = (title: string, due?: string) => ({ title, due: due ? new Date(due) : null, createdAt: new Date(), members: [] }) as unknown as CardData;
const sortBy = (name: string, cards: CardData[]) => [...cards].sort(SORTS.find(([l]) => l === name)![1]).map((c) => c.title);

test("due date puts undated cards last, ordered by name", () => {
  const cards = [card("b"), card("late", "2026-12-01"), card("a"), card("soon", "2026-11-01")];
  assert.deepEqual(sortBy("Due date (soonest first)", cards), ["soon", "late", "a", "b"]);
});

test("name sort is numeric and case-insensitive", () => {
  assert.deepEqual(sortBy("Name (A–Z)", [card("Card 10"), card("card 2"), card("Card 1")]), ["Card 1", "card 2", "Card 10"]);
});

test("group by assignee only reorders cards the sort ranks equal", () => {
  const c = (title: string, due: string | null, ...ids: string[]) =>
    ({ title, due: due ? new Date(due) : null, createdAt: new Date(), members: ids.map((userId) => ({ userId })) }) as unknown as CardData;
  const cards = [c("nov2", "2026-11-02T12:00", "a"), c("oct30-a", "2026-10-30T18:00", "a"), c("oct30-ab", "2026-10-30T09:00", "a", "b"), c("oct30-b", "2026-10-30T12:00", "b"), c("oct30-a2", "2026-10-30T20:00", "a"), c("none", null, "a")];
  const due = SORTS.find(([l]) => l === "Due date (soonest first)")!;
  assert.deepEqual(sortCards(cards, due, true).map((x) => x.title), ["oct30-a", "oct30-a2", "oct30-ab", "oct30-b", "nov2", "none"]);
  assert.deepEqual(sortCards(cards, due, false).map((x) => x.title), ["oct30-ab", "oct30-b", "oct30-a", "oct30-a2", "nov2", "none"]);
});

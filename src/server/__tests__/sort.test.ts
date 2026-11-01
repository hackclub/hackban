import assert from "node:assert/strict";
import { test } from "bun:test";

import { SORTS, groupByAssignee, type CardData } from "~/app/_components/board/types";

const card = (title: string, due?: string) => ({ title, due: due ? new Date(due) : null, createdAt: new Date(), members: [] }) as unknown as CardData;
const sortBy = (name: string, cards: CardData[]) => [...cards].sort(SORTS.find(([l]) => l === name)![1]).map((c) => c.title);

test("due date puts undated cards last, ordered by name", () => {
  const cards = [card("b"), card("late", "2026-12-01"), card("a"), card("soon", "2026-11-01")];
  assert.deepEqual(sortBy("Due date (soonest first)", cards), ["soon", "late", "a", "b"]);
});

test("name sort is numeric and case-insensitive", () => {
  assert.deepEqual(sortBy("Name (A–Z)", [card("Card 10"), card("card 2"), card("Card 1")]), ["Card 1", "card 2", "Card 10"]);
});

test("group by assignee keeps the primary order and orders groups by first appearance", () => {
  const c = (title: string, ...ids: string[]) => ({ title, members: ids.map((userId) => ({ userId })) }) as unknown as CardData;
  const cards = [c("1", "a"), c("2"), c("3", "b", "a"), c("4", "a"), c("5", "a", "b"), c("6")];
  assert.deepEqual(groupByAssignee(cards).map((x) => x.title), ["1", "4", "2", "6", "3", "5"]);
});

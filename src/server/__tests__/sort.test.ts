import assert from "node:assert/strict";
import { test } from "bun:test";

import { SORTS, type CardData } from "~/app/_components/board/types";

const card = (title: string, due?: string) => ({ title, due: due ? new Date(due) : null, createdAt: new Date(), members: [] }) as unknown as CardData;
const sortBy = (name: string, cards: CardData[]) => [...cards].sort(SORTS.find(([l]) => l === name)![1]).map((c) => c.title);

test("due date puts undated cards last, ordered by name", () => {
  const cards = [card("b"), card("late", "2026-12-01"), card("a"), card("soon", "2026-11-01")];
  assert.deepEqual(sortBy("Due date (soonest first)", cards), ["soon", "late", "a", "b"]);
});

test("name sort is numeric and case-insensitive", () => {
  assert.deepEqual(sortBy("Name (A–Z)", [card("Card 10"), card("card 2"), card("Card 1")]), ["Card 1", "card 2", "Card 10"]);
});

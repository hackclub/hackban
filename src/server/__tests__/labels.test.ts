import assert from "node:assert/strict";
import { test } from "bun:test";

import { sortCardLabels, sortLabels } from "~/lib/labels";

const l = (id: string, pos: string, color: string | null = "green", name = "") => ({ id, pos, color, name });

test("labels sort by their board position key", () => {
  assert.deepEqual(sortLabels([l("c", "a2"), l("a", "a0"), l("b", "a1")]).map((x) => x.id), ["a", "b", "c"]);
  // Keys from moving between neighbours sort between them.
  assert.deepEqual(sortLabels([l("z", "a1"), l("m", "a0V"), l("a", "a0")]).map((x) => x.id), ["a", "m", "z"]);
});

test("never-placed labels (no key) fall back to color, then name, with no color last", () => {
  const ls = [l("none", "", null), l("red", "", "red"), l("blue-b", "", "blue", "b"), l("blue-a", "", "blue", "a")];
  assert.deepEqual(sortLabels(ls).map((x) => x.id), ["blue-a", "blue-b", "red", "none"]);
});

test("labels created after never-placed ones go after them", () => {
  assert.deepEqual(sortLabels([l("new", "a0", "blue"), l("old", "", "yellow")]).map((x) => x.id), ["old", "new"]);
});

test("a card's labels follow the board order, not the order they were added", () => {
  const links = [{ label: l("type", "a1") }, { label: l("px", "a0") }, { label: l("misc", "a2") }];
  assert.deepEqual(sortCardLabels(links).map((x) => x.label.id), ["px", "type", "misc"]);
});

test("sorting doesn't mutate its input", () => {
  const ls = [l("b", "a1"), l("a", "a0")];
  sortLabels(ls);
  assert.deepEqual(ls.map((x) => x.id), ["b", "a"]);
});

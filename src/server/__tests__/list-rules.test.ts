import assert from "node:assert/strict";
import { test } from "bun:test";

import { planLabelChanges, planMove, type FlowList, type LabelRule } from "~/lib/list-flow";

const rule = (labelId: string, trigger: "enter" | "leave", action: "add" | "remove"): LabelRule => ({ labelId, trigger, action });
const sorted = (r: { add: string[]; remove: string[] }) => ({ add: [...r.add].sort(), remove: [...r.remove].sort() });

test("no rules change nothing", () => {
  assert.deepEqual(planLabelChanges(["a"], [], []), { add: [], remove: [] });
});

test("entering adds and removes labels", () => {
  const enter = [rule("done", "enter", "add"), rule("wip", "enter", "remove")];
  assert.deepEqual(sorted(planLabelChanges(["wip", "bug"], [], enter)), { add: ["done"], remove: ["wip"] });
});

test("leaving adds and removes labels", () => {
  const leave = [rule("wip", "leave", "remove"), rule("touched", "leave", "add")];
  assert.deepEqual(sorted(planLabelChanges(["wip"], leave, [])), { add: ["touched"], remove: ["wip"] });
});

test("the new list's enter rules win over the old list's leave rules", () => {
  // Old list removes "x" on leave; new list adds it on enter: it stays.
  assert.deepEqual(planLabelChanges(["x"], [rule("x", "leave", "remove")], [rule("x", "enter", "add")]), { add: [], remove: [] });
  // Old list adds "y" on leave; new list removes it on enter: it never appears.
  assert.deepEqual(planLabelChanges([], [rule("y", "leave", "add")], [rule("y", "enter", "remove")]), { add: [], remove: [] });
});

test("only leave rules count for the old list and enter rules for the new one", () => {
  // A list's own enter rules don't fire when a card leaves it, and vice versa.
  assert.deepEqual(planLabelChanges([], [rule("a", "enter", "add")], [rule("b", "leave", "add")]), { add: [], remove: [] });
});

test("adding a label the card already has is a no-op", () => {
  assert.deepEqual(planLabelChanges(["a"], [], [rule("a", "enter", "add")]), { add: [], remove: [] });
});

const list = (id: string, over: Partial<FlowList> = {}): FlowList => ({ id, boardId: "b", doneOnEnter: false, labelRules: [], ...over });
const card = (labelIds: string[], due: Date | null = new Date(), dueComplete = false) => ({ labelIds, due, dueComplete });

test("moving within one list does nothing", () => {
  const l = list("a", { doneOnEnter: true, labelRules: [rule("x", "enter", "add")] });
  assert.deepEqual(planMove(card([]), l, l), { add: [], remove: [], complete: false });
});

test("mark complete works with or without a due date, and skips cards already complete", () => {
  const done = list("done", { doneOnEnter: true });
  assert.equal(planMove(card([]), list("a"), done).complete, true);
  assert.equal(planMove(card([], null), list("a"), done).complete, true);
  assert.equal(planMove(card([], new Date(), true), list("a"), done).complete, false);
});

test("the old list's leave rules are skipped when moving to another board", () => {
  const from = list("a", { boardId: "b1", labelRules: [rule("x", "leave", "add")] });
  const to = list("z", { boardId: "b2", labelRules: [rule("y", "enter", "add")] });
  assert.deepEqual(planMove(card([]), from, to), { add: ["y"], remove: [], complete: false });
});

// List flow: what happens to a card when it moves between lists. Pure, so the
// server applies it and the board applies the same thing optimistically.

export const FLOW_TRIGGERS = ["enter", "leave"] as const;
export const FLOW_ACTIONS = ["add", "remove"] as const;
export type FlowTrigger = (typeof FLOW_TRIGGERS)[number];
export type FlowAction = (typeof FLOW_ACTIONS)[number];
export type LabelRule = { labelId: string; trigger: string; action: string };
export type FlowList = { id: string; boardId: string; doneOnEnter: boolean; labelRules: LabelRule[] };

/** Whether a list does anything to cards moving in or out of it. */
export const hasFlow = (l: Pick<FlowList, "doneOnEnter" | "labelRules">) => l.doneOnEnter || l.labelRules.length > 0;

/**
 * Which labels a card gains and loses when it moves lists.
 *
 * The old list's `leave` rules run first, then the new list's `enter` rules,
 * so the list a card lands in has the last word (e.g. a label removed on
 * leaving A but added on entering B ends up on the card). Within one list,
 * removes run before adds.
 */
export function planLabelChanges(current: Iterable<string>, leave: LabelRule[], enter: LabelRule[]) {
  const before = new Set(current);
  const after = new Set(before);
  for (const rules of [leave.filter((r) => r.trigger === "leave"), enter.filter((r) => r.trigger === "enter")]) {
    for (const r of rules) if (r.action === "remove") after.delete(r.labelId);
    for (const r of rules) if (r.action === "add") after.add(r.labelId);
  }
  return {
    add: [...after].filter((id) => !before.has(id)),
    remove: [...before].filter((id) => !after.has(id)),
  };
}

/**
 * Everything a move from `from` to `to` does to a card. The old list only
 * counts when it's on the same board (labels are board-scoped). "Mark
 * complete" works with or without a due date, like the card's own checkmark.
 */
export function planMove(
  card: { labelIds: Iterable<string>; due: Date | null; dueComplete: boolean },
  from: FlowList | null | undefined,
  to: FlowList,
) {
  if (from?.id === to.id) return { add: [], remove: [], complete: false };
  const leave = from?.boardId === to.boardId ? from.labelRules : [];
  const { add, remove } = planLabelChanges(card.labelIds, leave, to.labelRules);
  return { add, remove, complete: to.doneOnEnter && !card.dueComplete };
}

export const isNoop = (p: ReturnType<typeof planMove>) => !p.add.length && !p.remove.length && !p.complete;

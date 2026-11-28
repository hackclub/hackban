import { type db as Db } from "~/server/db";
import { hasFlow, isNoop, planMove, type FlowList } from "~/lib/list-flow";

type DB = typeof Db;

const flowSelect = { id: true, boardId: true, doneOnEnter: true, labelRules: { select: { labelId: true, trigger: true, action: true } } } as const;

/**
 * Load the two lists of a move, or null when the move can't trigger
 * anything (same list, or neither list has a flow that applies).
 */
export async function loadFlow(db: DB, fromListId: string | null, toListId: string) {
  if (fromListId === toListId) return null;
  const lists: FlowList[] = await db.list.findMany({ where: { id: { in: fromListId ? [fromListId, toListId] : [toListId] } }, select: flowSelect });
  const to = lists.find((l) => l.id === toListId);
  if (!to) return null;
  const from = lists.find((l) => l.id === fromListId && l.boardId === to.boardId) ?? null;
  if (!hasFlow(to) && !from?.labelRules.length) return null;
  return { from, to };
}

type Flow = NonNullable<Awaited<ReturnType<typeof loadFlow>>>;
type FlowCard = { id: string; due: Date | null; dueComplete: boolean; labels: { labelId: string }[] };

/** Apply a loaded flow to one card that has already moved. Returns whether it changed. */
export async function applyFlow(db: DB, card: FlowCard, { from, to }: Flow) {
  const plan = planMove({ labelIds: card.labels.map((l) => l.labelId), due: card.due, dueComplete: card.dueComplete }, from, to);
  if (isNoop(plan)) return false;
  const cardId = card.id;
  await db.$transaction([
    ...(plan.remove.length ? [db.cardLabel.deleteMany({ where: { cardId, labelId: { in: plan.remove } } })] : []),
    ...(plan.add.length ? [db.cardLabel.createMany({ data: plan.add.map((labelId) => ({ cardId, labelId })), skipDuplicates: true })] : []),
    // Straight to complete: a repeating card isn't rolled to its next date
    // here, since it's sitting in a "done" list now.
    ...(plan.complete ? [db.card.update({ where: { id: cardId }, data: { dueComplete: true } })] : []),
  ]);
  return true;
}

export const flowCardSelect = { id: true, due: true, dueComplete: true, labels: { select: { labelId: true } } } as const;

/**
 * Run list flow for a card that just moved from `fromListId` to `toListId`.
 * Call after the move and after any cross-board label cleanup.
 */
export async function applyListRules(db: DB, cardId: string, fromListId: string | null, toListId: string) {
  const flow = await loadFlow(db, fromListId, toListId);
  if (!flow) return false;
  const card = await db.card.findUniqueOrThrow({ where: { id: cardId }, select: flowCardSelect });
  return applyFlow(db, card, flow);
}

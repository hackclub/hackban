"use client";

import { hasFlow, isNoop, planMove } from "~/lib/list-flow";
import { api, type RouterOutputs } from "~/trpc/react";

import { type BoardData, type CardData } from "./types";

type CardDetail = RouterOutputs["card"]["get"];

/** Optimistic card id -> the real id, once the server has created it. */
export const realIds = new Map<string, string>();
type Member = BoardData["members"][number];

/**
 * Instant (optimistic) card edits: patch the card everywhere it's shown at
 * once, i.e. the card front in `board.get` and the open card in `card.get`.
 * The server confirms in the background; the sync gate in query-client.ts
 * makes sure a refetch can't land on top of this.
 *
 * Only the list containing the card gets a new object, so memoized columns
 * and cards elsewhere don't re-render.
 */
export function usePatchCard(boardId: string) {
  const utils = api.useUtils();
  return (
    cardId: string,
    patch: {
      front?: (c: CardData) => CardData;
      detail?: (c: CardDetail) => CardDetail;
    },
  ) => {
    if (patch.front) {
      const front = patch.front;
      utils.board.get.setData({ id: boardId }, (b) =>
        b && {
          ...b,
          lists: b.lists.map((l) =>
            l.cards.some((c) => c.id === cardId) ? { ...l, cards: l.cards.map((c) => (c.id === cardId ? front(c) : c)) } : l,
          ),
        },
      );
    }
    if (patch.detail) {
      const detail = patch.detail;
      utils.card.get.setData({ id: cardId }, (c) => c && detail(c));
    }
  };
}

/** Optimistic patches for adding/removing a card member, from the board's member list. */
export function memberPatch(member: Member | undefined, userId: string, on: boolean) {
  return {
    front: (c: CardData): CardData => ({
      ...c,
      members:
        on && member
          ? c.members.some((m) => m.userId === userId)
            ? c.members
            : [...c.members, { cardId: c.id, userId, user: { id: member.user.id, name: member.user.name, image: member.user.image } }]
          : c.members.filter((m) => m.userId !== userId),
    }),
    detail: (c: CardDetail): CardDetail => ({
      ...c,
      members:
        on && member
          ? c.members.some((m) => m.userId === userId)
            ? c.members
            : [...c.members, { cardId: c.id, userId, user: { ...member.user, username: member.user.username } }]
          : c.members.filter((m) => m.userId !== userId),
    }),
  };
}

/** Optimistic patches for a card's title and scalar date/completion fields. */
export function fieldsPatch(fields: Partial<Pick<CardData, "title" | "start" | "due" | "dueComplete" | "recurrence">>) {
  return {
    front: (c: CardData): CardData => ({ ...c, ...fields }),
    detail: (c: CardDetail): CardDetail => ({ ...c, ...fields }),
  };
}

/**
 * The board with list flow applied to cards that just moved from
 * `fromListId` into `toListId` (they must already sit in `toListId`), so
 * labels and the due checkmark change the moment a card is dropped.
 */
export function withFlow(b: BoardData, cardIds: string[], fromListId: string, toListId: string): BoardData {
  const from = b.lists.find((l) => l.id === fromListId);
  const to = b.lists.find((l) => l.id === toListId);
  if (!to || from === to || (!hasFlow(to) && !from?.labelRules.length)) return b;
  const ids = new Set(cardIds);
  const flowCard = (c: CardData): CardData => {
    if (!ids.has(c.id)) return c;
    const plan = planMove({ labelIds: c.labels.map((x) => x.labelId), due: c.due, dueComplete: c.dueComplete }, from, to);
    if (isNoop(plan)) return c;
    const added = plan.add.flatMap((labelId) => {
      const label = b.labels.find((l) => l.id === labelId);
      return label ? [{ cardId: c.id, labelId, label }] : [];
    });
    return { ...c, labels: [...c.labels.filter((x) => !plan.remove.includes(x.labelId)), ...added], dueComplete: c.dueComplete || plan.complete };
  };
  return { ...b, lists: b.lists.map((l) => (l.id === toListId ? { ...l, cards: l.cards.map(flowCard) } : l)) };
}

/** What list automation does to `cardId` moving from `fromListId` to `toListId`, or null if nothing. */
export function flowPlan(b: BoardData, cardId: string, fromListId: string, toListId: string) {
  const from = b.lists.find((l) => l.id === fromListId);
  const to = b.lists.find((l) => l.id === toListId);
  const card = from?.cards.find((c) => c.id === cardId);
  if (!to || !card) return null;
  const plan = planMove({ labelIds: card.labels.map((x) => x.labelId), due: card.due, dueComplete: card.dueComplete }, from, to);
  return isNoop(plan) ? null : plan;
}

"use client";

import { api, type RouterOutputs } from "~/trpc/react";

import { type BoardData, type CardData } from "./types";

type CardDetail = RouterOutputs["card"]["get"];
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

/** Optimistic patches for any scalar date/completion fields. */
export function fieldsPatch(fields: Partial<Pick<CardData, "start" | "due" | "dueComplete" | "recurrence">>) {
  return {
    front: (c: CardData): CardData => ({ ...c, ...fields }),
    detail: (c: CardDetail): CardDetail => ({ ...c, ...fields }),
  };
}

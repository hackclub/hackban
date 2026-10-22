import { TRPCError } from "@trpc/server";

import { type db as Db } from "~/server/db";
import { publish } from "~/server/realtime";

type DB = typeof Db;

export async function requireBoard(
  db: DB,
  userId: string,
  boardId: string,
  write = true,
) {
  const board = await db.board.findUnique({
    where: { id: boardId },
    include: {
      members: { where: { userId } },
      workspace: { include: { members: { where: { userId } } } },
    },
  });
  if (!board) throw new TRPCError({ code: "NOT_FOUND" });
  const member = board.members[0];
  const wsMember = board.workspace.members[0];
  const canRead =
    !!member ||
    board.visibility === "public" ||
    (board.visibility === "workspace" && !!wsMember);
  if (!canRead) throw new TRPCError({ code: "FORBIDDEN" });
  const canWrite =
    (!!member && member.role !== "observer") ||
    (!member && board.visibility === "workspace" && !!wsMember);
  if (write && !canWrite) throw new TRPCError({ code: "FORBIDDEN" });
  return board;
}

export async function boardIdForList(db: DB, listId: string) {
  const list = await db.list.findUnique({
    where: { id: listId },
    select: { boardId: true },
  });
  if (!list) throw new TRPCError({ code: "NOT_FOUND" });
  return list.boardId;
}

export async function boardIdForCard(db: DB, cardId: string) {
  const card = await db.card.findUnique({
    where: { id: cardId },
    select: { list: { select: { boardId: true } } },
  });
  if (!card) throw new TRPCError({ code: "NOT_FOUND" });
  return card.list.boardId;
}

export async function requireCard(db: DB, userId: string, cardId: string, write = true) {
  const boardId = await boardIdForCard(db, cardId);
  await requireBoard(db, userId, boardId, write);
  return boardId;
}

/**
 * Record an activity entry and notify realtime subscribers.
 *
 * Runs in the background: the mutation's real change is already committed,
 * so callers (and the user) don't wait on the extra insert. The realtime
 * event fires after the insert so other viewers' activity feeds include it.
 */
export function logActivity(
  db: DB,
  a: {
    boardId: string;
    cardId?: string | null;
    actorId: string;
    type: string;
    data?: Record<string, unknown>;
    origin?: string;
  },
) {
  void db.activity
    .create({
      data: {
        boardId: a.boardId,
        cardId: a.cardId ?? null,
        actorId: a.actorId,
        type: a.type,
        data: JSON.stringify(a.data ?? {}),
      },
    })
    .catch((e: unknown) => console.error("[activity] insert failed", a.type, e))
    .finally(() => touch(a.boardId, a.cardId ?? undefined, a.origin));
}

/** Notify subscribers that a board (and optionally a card) changed. */
export function touch(boardId: string, cardId?: string, origin?: string) {
  publish({ boardId, cardId, origin, kind: cardId ? "card" : "board" });
}

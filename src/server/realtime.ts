import { EventEmitter } from "node:events";

export type BoardEvent = {
  boardId: string;
  cardId?: string;
  // client id of the tab that caused the change, so it can skip its own echo
  origin?: string;
  kind: "board" | "card" | "deleted";
};

const globalForBus = globalThis as unknown as { boardBus?: EventEmitter };

export const boardBus = globalForBus.boardBus ?? new EventEmitter();
boardBus.setMaxListeners(0);
globalForBus.boardBus = boardBus;

export function publish(event: BoardEvent) {
  boardBus.emit(`board:${event.boardId}`, event);
}

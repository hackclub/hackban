"use client";

import {
  closestCenter,
  closestCorners,
  DndContext,
  DragOverlay,
  KeyboardSensor,
  PointerSensor,
  pointerWithin,
  useSensor,
  useSensors,
  type CollisionDetection,
  type DragEndEvent,
  type DragOverEvent,
  type DragStartEvent,
} from "@dnd-kit/core";
import {
  arrayMove,
  horizontalListSortingStrategy,
  SortableContext,
  sortableKeyboardCoordinates,
} from "@dnd-kit/sortable";
import { motion } from "framer-motion";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";

import { useQueryClient } from "@tanstack/react-query";

import { type AppQueryClient } from "~/trpc/query-client";
import { api, clientId } from "~/trpc/react";

import { Header } from "../header";
import { boardBg } from "../ui";
import { BoardHeader } from "./board-header";
import { BoardMenu } from "./board-menu";
import { BoardCtx } from "./members";
import { confetti } from "../confetti";
import { CardFront, REPEAT_SHOW_DONE_MS } from "./card-front";
import { CardModal } from "./card-modal";
import { ListColumn, ListComposer } from "./list-column";
import { memberPatch, usePatchCard } from "./optimistic";
import { QuickEdit } from "./quick-edit";
import {
  cardMatches,
  emptyFilters,
  filterActive,
  type BoardData,
  type CardData,
  type Filters,
} from "./types";

type User = {
  id: string;
  name?: string | null;
  image?: string | null;
  email?: string | null;
};

// list id -> ordered card ids, plus list order. Used as the drag-time model.
type Layout = { lists: string[]; cards: Record<string, string[]> };

function layoutOf(b: BoardData): Layout {
  return {
    lists: b.lists.map((l) => l.id),
    cards: Object.fromEntries(
      b.lists.map((l) => [l.id, l.cards.map((c) => c.id)]),
    ),
  };
}

/**
 * Rebuild the board in `layout` order. Object identity is preserved for every
 * list and card that didn't move, so memoized columns/cards skip re-rendering
 * while dragging — only the one or two affected lists update.
 */
function applyLayout(b: BoardData, layout: Layout): BoardData {
  const cards = new Map(b.lists.flatMap((l) => l.cards).map((c) => [c.id, c]));
  const lists = new Map(b.lists.map((l) => [l.id, l]));
  return {
    ...b,
    lists: layout.lists
      .map((id) => lists.get(id))
      .filter((l): l is BoardData["lists"][number] => !!l)
      .map((l) => {
        const ids = layout.cards[l.id] ?? [];
        if (
          ids.length === l.cards.length &&
          ids.every((id, i) => l.cards[i]!.id === id)
        )
          return l;
        return {
          ...l,
          cards: ids
            .map((id) => cards.get(id))
            .filter((c): c is CardData => !!c)
            .map((c) => (c.listId === l.id ? c : { ...c, listId: l.id })),
        };
      }),
  };
}

const findList = (layout: Layout, cardId: string) =>
  Object.keys(layout.cards).find((l) => layout.cards[l]!.includes(cardId));

export function BoardView({
  boardId,
  initialCardId,
  user,
}: {
  boardId: string;
  initialCardId?: string;
  user: User;
}) {
  const utils = api.useUtils();
  const { data: board, error } = api.board.get.useQuery({ id: boardId });

  // ----- realtime -----
  api.board.onEvent.useSubscription(
    { id: boardId },
    {
      onData: (ev) => {
        if (ev.origin === clientId) return;
        void utils.board.get.invalidate({ id: boardId });
        if (ev.cardId) void utils.card.get.invalidate({ id: ev.cardId });
        void utils.board.activity.invalidate({ id: boardId });
      },
    },
  );

  // ----- open card <-> URL (/c/:id) without remounting the board -----
  const [openCard, setOpenCard] = useState<string | null>(
    initialCardId ?? null,
  );
  const boardUrl = `/b/${boardId}`;
  const open = useCallback(
    (id: string | null) => {
      setOpenCard(id);
      window.history.pushState(null, "", id ? `/c/${id}` : boardUrl);
    },
    [boardUrl],
  );
  useEffect(() => {
    const onPop = () => {
      const m = /^\/c\/([^/]+)/.exec(window.location.pathname);
      setOpenCard(m?.[1] ?? null);
    };
    window.addEventListener("popstate", onPop);
    return () => window.removeEventListener("popstate", onPop);
  }, []);
  useEffect(() => {
    if (board) document.title = `${board.name} | Hackban`;
  }, [board]);

  // ----- filters, menu, quick edit, composers -----
  // Filters stick across card opens/reloads on this board; switching boards
  // drops them (only one board's filters are ever stored).
  const [filters, setFilters] = useState<Filters>(emptyFilters);
  useEffect(() => {
    try {
      const saved = JSON.parse(sessionStorage.getItem("boardFilters") ?? "null") as { boardId: string; filters: Filters } | null;
      if (saved?.boardId === boardId) setFilters(saved.filters);
      else sessionStorage.removeItem("boardFilters");
    } catch {}
  }, [boardId]);
  useEffect(() => {
    try {
      if (filterActive(filters)) sessionStorage.setItem("boardFilters", JSON.stringify({ boardId, filters }));
      else if ((JSON.parse(sessionStorage.getItem("boardFilters") ?? "null") as { boardId: string } | null)?.boardId === boardId) sessionStorage.removeItem("boardFilters");
    } catch {}
  }, [boardId, filters]);
  const [menuOpen, setMenuOpen] = useState(false);
  const [quick, setQuick] = useState<{ card: CardData; rect: DOMRect } | null>(
    null,
  );
  const [composer, setComposer] = useState<{
    listId: string;
    where: "top" | "bottom";
  } | null>(null);
  const hovered = useRef<string | null>(null);
  const readOnly = board?.myRole === "observer";

  // ----- drag and drop -----
  const [drag, setDrag] = useState<{
    layout: Layout;
    active: { type: "card"; card: CardData } | { type: "list"; id: string };
  } | null>(null);
  const shown = useMemo(
    () => (board && drag ? applyLayout(board, drag.layout) : board),
    [board, drag],
  );
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 6 } }),
    useSensor(KeyboardSensor, {
      coordinateGetter: sortableKeyboardCoordinates,
    }),
  );
  const moveCard = api.card.move.useMutation({
    onSettled: () => utils.board.get.invalidate({ id: boardId }),
  });
  const moveList = api.list.move.useMutation({
    onSettled: () => utils.board.get.invalidate({ id: boardId }),
  });

  // Read drag state through a ref so the collision function stays stable.
  const dragRef = useRef(drag);
  dragRef.current = drag;
  const collision: CollisionDetection = useCallback((args) => {
    if (dragRef.current?.active.type === "list") {
      return closestCenter({
        ...args,
        droppableContainers: args.droppableContainers.filter((c) =>
          String(c.id).startsWith("list:"),
        ),
      });
    }
    const within = pointerWithin(args);
    // Prefer cards under the pointer; fall back to the list column itself.
    const card = within.find((c) => String(c.id).startsWith("card:"));
    if (card) return [card];
    const list = within.find((c) => String(c.id).startsWith("list:"));
    if (list) {
      const listId = String(list.id).slice(5);
      const cardsIn = args.droppableContainers.filter(
        (c) =>
          String(c.id).startsWith("card:") &&
          dragRef.current?.layout.cards[listId]?.includes(
            String(c.id).slice(5),
          ),
      );
      if (cardsIn.length)
        return closestCorners({ ...args, droppableContainers: cardsIn });
      return [list];
    }
    return closestCorners(args);
  }, []);

  // Hold board refetches for the whole drag (incl. other people's realtime
  // updates) so data can't shift under the cursor; released on drop.
  const queryClient = useQueryClient() as AppQueryClient;
  const releaseHold = useRef<(() => void) | null>(null);
  const endHold = () => {
    releaseHold.current?.();
    releaseHold.current = null;
  };

  const onDragStart = ({ active }: DragStartEvent) => {
    if (!board) return;
    endHold();
    releaseHold.current = queryClient.hold();
    const data = active.data.current as
      { type: "card"; card: CardData } | { type: "list" };
    setDrag({
      layout: layoutOf(board),
      active:
        data.type === "card"
          ? { type: "card", card: data.card }
          : { type: "list", id: String(active.id).slice(5) },
    });
    setQuick(null);
  };

  const onDragOver = ({ active, over }: DragOverEvent) => {
    if (drag?.active.type !== "card" || !over) return;
    const cardId = String(active.id).slice(5);
    const overId = String(over.id);
    setDrag((d) => {
      if (!d) return d;
      const from = findList(d.layout, cardId);
      const to = overId.startsWith("list:")
        ? overId.slice(5)
        : findList(d.layout, overId.slice(5));
      if (!from || !to || from === to) return d;
      const fromCards = d.layout.cards[from]!.filter((id) => id !== cardId);
      const toCards = [...d.layout.cards[to]!];
      let idx = toCards.length;
      if (overId.startsWith("card:")) {
        idx = toCards.indexOf(overId.slice(5));
        const below =
          over.rect &&
          active.rect.current.translated &&
          active.rect.current.translated.top >
            over.rect.top + over.rect.height / 2;
        if (below) idx += 1;
      }
      toCards.splice(idx, 0, cardId);
      return {
        ...d,
        layout: {
          ...d.layout,
          cards: { ...d.layout.cards, [from]: fromCards, [to]: toCards },
        },
      };
    });
  };

  const onDragEnd = (e: DragEndEvent) => {
    // Release after the move mutation has started, so it keeps refetches
    // queued until the server confirms.
    try {
      handleDragEnd(e);
    } finally {
      endHold();
    }
  };

  const handleDragEnd = ({ active, over }: DragEndEvent) => {
    const d = drag;
    setDrag(null);
    if (!d || !board) return;
    let layout = d.layout;
    if (d.active.type === "list") {
      const id = d.active.id;
      if (over && String(over.id).startsWith("list:")) {
        const oldI = layout.lists.indexOf(id);
        const newI = layout.lists.indexOf(String(over.id).slice(5));
        if (oldI !== newI)
          layout = { ...layout, lists: arrayMove(layout.lists, oldI, newI) };
      }
      const i = layout.lists.indexOf(id);
      if (layout.lists.join() === board.lists.map((l) => l.id).join()) return;
      utils.board.get.setData(
        { id: boardId },
        (b) => b && applyLayout(b, layout),
      );
      moveList.mutate({ id, afterId: i === 0 ? null : layout.lists[i - 1]! });
      return;
    }
    const cardId = String(active.id).slice(5);
    const listId = findList(layout, cardId);
    if (!listId) return;
    if (over && String(over.id).startsWith("card:")) {
      const overId = String(over.id).slice(5);
      const arr = layout.cards[listId]!;
      if (arr.includes(overId) && overId !== cardId) {
        layout = {
          ...layout,
          cards: {
            ...layout.cards,
            [listId]: arrayMove(arr, arr.indexOf(cardId), arr.indexOf(overId)),
          },
        };
      }
    }
    const arr = layout.cards[listId]!;
    const i = arr.indexOf(cardId);
    const orig = layoutOf(board);
    const origList = findList(orig, cardId);
    if (origList === listId && orig.cards[listId]!.join() === arr.join())
      return;
    utils.board.get.setData(
      { id: boardId },
      (b) => b && applyLayout(b, layout),
    );
    moveCard.mutate({
      id: cardId,
      listId,
      afterId: i === 0 ? null : arr[i - 1]!,
    });
  };

  // ----- keyboard shortcuts (Trello's) -----
  const patchCard = usePatchCard(boardId);
  // You, as a card member (works even if you're only in the workspace).
  const selfMember = board?.members.find((m) => m.userId === user.id) ?? {
    boardId,
    userId: user.id,
    role: "normal",
    lastViewed: null,
    guest: false,
    user: { id: user.id, name: user.name ?? null, image: user.image ?? null, username: null, isGhost: false },
  };
  const update = api.card.update.useMutation({
    onSettled: (_d, _e, vars) => {
      // Repeating cards read as done for a beat before rolling to the next date.
      const repeating = vars.dueComplete && board?.lists.some((l) => l.cards.some((c) => c.id === vars.id && c.recurrence));
      setTimeout(() => void utils.board.get.invalidate({ id: boardId }), repeating ? REPEAT_SHOW_DONE_MS : 0);
    },
  });
  const toggleMember = api.card.toggleMember.useMutation({
    onSettled: () => utils.board.get.invalidate({ id: boardId }),
  });
  const toggleLabel = api.card.toggleLabel.useMutation({
    onSettled: () => utils.board.get.invalidate({ id: boardId }),
  });
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement;
      if (
        /INPUT|TEXTAREA|SELECT/.test(t.tagName) ||
        t.isContentEditable ||
        e.metaKey ||
        e.ctrlKey ||
        e.altKey
      )
        return;
      if (document.querySelector("[data-popover]")) return;
      const cardId = openCard ?? hovered.current;
      const card = board?.lists
        .flatMap((l) => l.cards)
        .find((c) => c.id === cardId);
      switch (e.key) {
        case "q":
          setFilters((f) => ({
            ...f,
            members: f.members.includes(user.id)
              ? f.members.filter((m) => m !== user.id)
              : [...f.members, user.id],
          }));
          break;
        case "x":
          setFilters(emptyFilters);
          break;
        case "w":
          setMenuOpen((m) => !m);
          break;
        case "Escape":
          if (openCard) open(null);
          else setMenuOpen(false);
          break;
      }
      if (!card || readOnly) return;
      switch (e.key) {
        case "c":
          update.mutate({ id: card.id, closed: true });
          utils.board.get.setData(
            { id: boardId },
            (b) =>
              b && {
                ...b,
                lists: b.lists.map((l) => ({
                  ...l,
                  cards: l.cards.filter((c) => c.id !== card.id),
                })),
              },
          );
          if (openCard) open(null);
          break;
        case " ": {
          e.preventDefault();
          const on = !card.members.some((m) => m.userId === user.id);
          patchCard(card.id, memberPatch(selfMember, user.id, on));
          toggleMember.mutate({ id: card.id, userId: user.id, on });
          break;
        }
        case "d": {
          const el = document.querySelector<HTMLElement>(`[data-card-id="${card.id}"]`);
          if (!card.dueComplete && el) confetti(el);
          update.mutate({ id: card.id, dueComplete: !card.dueComplete });
          utils.board.get.setData(
            { id: boardId },
            (b) =>
              b && {
                ...b,
                lists: b.lists.map((l) => ({
                  ...l,
                  cards: l.cards.map((c) =>
                    c.id === card.id
                      ? { ...c, dueComplete: !c.dueComplete }
                      : c,
                  ),
                })),
              },
          );
          break;
        }
        case "e":
          if (!openCard) {
            const el = document.querySelector(`[data-card-id="${card.id}"]`);
            if (el) setQuick({ card, rect: el.getBoundingClientRect() });
          }
          break;
        case "Enter":
          if (!openCard) open(card.id);
          break;
        default:
          if (/^[0-9]$/.test(e.key) && board) {
            // 1..0 toggle the board's labels in order, like Trello
            const label = board.labels[(Number(e.key) + 9) % 10];
            if (label) {
              const on = !card.labels.some((l) => l.labelId === label.id);
              const withLabel = <T extends { id: string; labels: { cardId: string; labelId: string; label: typeof label }[] }>(c: T): T => ({
                ...c,
                labels: on ? [...c.labels, { cardId: c.id, labelId: label.id, label }] : c.labels.filter((x) => x.labelId !== label.id),
              });
              patchCard(card.id, { front: withLabel, detail: withLabel });
              toggleLabel.mutate({ id: card.id, labelId: label.id, on });
            }
          }
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  });

  const isVisible = useMemo(
    () =>
      filterActive(filters)
        ? (c: CardData) => cardMatches(c, filters)
        : () => true,
    [filters],
  );
  const onQuickEdit = useCallback(
    (card: CardData, el: HTMLElement) =>
      setQuick({ card, rect: el.getBoundingClientRect() }),
    [],
  );
  const onHoverCard = useCallback((id: string | null) => {
    hovered.current = id;
  }, []);
  const onComposer = useCallback(
    (listId: string, where: "top" | "bottom" | null) =>
      setComposer(where ? { listId, where } : null),
    [],
  );
  const boardCtx = useMemo(
    () => ({
      meId: user.id,
      filterMember: (id: string) =>
        setFilters((f) =>
          f.members.includes(id) ? f : { ...f, members: [...f.members, id] },
        ),
    }),
    [user.id],
  );

  if (error) {
    return (
      <div className="flex h-full flex-col">
        <Header user={user} />
        <div className="mx-auto mt-24 max-w-md text-center">
          <h1 className="mb-2 text-2xl font-semibold">Board not found</h1>
          <p className="text-[var(--color-text-subtle)]">
            This board may be private. If someone gave you this link, they may
            need to share the board with you.
          </p>
        </div>
      </div>
    );
  }

  return (
    <BoardCtx.Provider value={boardCtx}>
      <div
        className="flex h-full flex-col overflow-hidden transition-[background-color] duration-300"
        style={shown ? boardBg(shown) : { background: "var(--color-page)" }}
      >
        <Header user={user} translucent />
        {shown && (
          <div className="flex min-h-0 flex-1 animate-[fade-in_200ms_ease-out] flex-col">
            <BoardHeader
              board={shown}
              meId={user.id}
              filters={filters}
              setFilters={setFilters}
              onMenu={() => setMenuOpen((m) => !m)}
            />
            <div className="relative flex min-h-0 flex-1">
              <DndContext
                sensors={sensors}
                collisionDetection={collision}
                onDragStart={onDragStart}
                onDragOver={onDragOver}
                onDragEnd={onDragEnd}
                onDragCancel={() => {
                  setDrag(null);
                  endHold();
                }}
              >
                <BoardCanvas>
                  <SortableContext
                    items={shown.lists.map((l) => `list:${l.id}`)}
                    strategy={horizontalListSortingStrategy}
                  >
                    {shown.lists.map((l) => (
                      <ListColumn
                        key={l.id}
                        list={l}
                        board={board!}
                        cards={l.cards}
                        isVisible={isVisible}
                        onOpenCard={open}
                        onQuickEdit={onQuickEdit}
                        onHoverCard={onHoverCard}
                        composerAt={
                          composer?.listId === l.id ? composer.where : null
                        }
                        onComposer={onComposer}
                        readOnly={readOnly}
                      />
                    ))}
                  </SortableContext>
                  {!readOnly && <ListComposer boardId={boardId} />}
                </BoardCanvas>
                {typeof document !== "undefined" &&
                  createPortal(
                    <DragOverlay
                      dropAnimation={{
                        duration: 180,
                        easing: "cubic-bezier(.2,1,.1,1)",
                      }}
                    >
                      {drag?.active.type === "card" && (
                        <motion.div
                          initial={{ rotate: 0 }}
                          animate={{ rotate: 4 }}
                          transition={{ duration: 0.12 }}
                          className="cursor-grabbing rounded-lg shadow-[var(--shadow-raised)]"
                        >
                          <CardFront
                            card={drag.active.card}
                            boardId={boardId}
                            overlay
                          />
                        </motion.div>
                      )}
                      {drag?.active.type === "list" &&
                        (() => {
                          const l = shown.lists.find(
                            (x) => x.id === (drag.active as { id: string }).id,
                          );
                          return l ? (
                            <motion.div
                              initial={{ rotate: 0 }}
                              animate={{ rotate: 3 }}
                              className="w-[272px] cursor-grabbing rounded-xl bg-[var(--color-list)] p-2 opacity-95 shadow-[var(--shadow-raised)]"
                            >
                              <h2 className="px-2 py-1.5 text-sm font-semibold">
                                {l.name}
                              </h2>
                              <div className="flex flex-col gap-2">
                                {l.cards.slice(0, 8).map((c) => (
                                  <CardFront
                                    key={c.id}
                                    card={c}
                                    boardId={boardId}
                                    overlay
                                  />
                                ))}
                              </div>
                            </motion.div>
                          ) : null;
                        })()}
                    </DragOverlay>,
                    document.body,
                  )}
              </DndContext>
              <BoardMenu
                board={shown}
                open={menuOpen}
                onClose={() => setMenuOpen(false)}
                onOpenCard={open}
              />
            </div>
          </div>
        )}
        {!shown && <BoardSkeleton />}
        {quick && board && (
          <QuickEdit
            card={quick.card}
            rect={quick.rect}
            board={board}
            onClose={() => setQuick(null)}
            onOpen={() => {
              setQuick(null);
              open(quick.card.id);
            }}
          />
        )}
        <CardModal
          cardId={openCard}
          board={board}
          onClose={() => open(null)}
          onOpenCard={open}
          user={user}
        />
      </div>
    </BoardCtx.Provider>
  );
}

/** Horizontal board canvas; click-and-drag on empty space scrolls, like Trello. */
function BoardCanvas({ children }: { children: React.ReactNode }) {
  const ref = useRef<HTMLDivElement>(null);
  const pan = useRef<{ x: number; left: number } | null>(null);
  return (
    <div
      ref={ref}
      className="board-scroll flex min-h-0 flex-1 items-start gap-3 overflow-x-auto overflow-y-hidden px-3 pt-3 pb-4"
      onMouseDown={(e) => {
        if (e.target !== e.currentTarget || e.button !== 0) return;
        pan.current = { x: e.clientX, left: ref.current!.scrollLeft };
        const move = (ev: MouseEvent) => {
          if (pan.current && ref.current)
            ref.current.scrollLeft =
              pan.current.left - (ev.clientX - pan.current.x);
        };
        const up = () => {
          pan.current = null;
          window.removeEventListener("mousemove", move);
          window.removeEventListener("mouseup", up);
        };
        window.addEventListener("mousemove", move);
        window.addEventListener("mouseup", up);
      }}
    >
      {children}
    </div>
  );
}

/**
 * Loading state: a quiet, Trello-shaped skeleton on the page background
 * (no bright placeholder color) that shimmers until the board arrives.
 */
function BoardSkeleton() {
  // Fixed card heights per list so it looks like a real board, not a grid.
  const lists = [
    [56, 76, 56, 96],
    [76, 56, 56],
    [56, 96, 56, 56, 76],
    [56, 56],
  ];
  return (
    <div className="flex min-h-0 flex-1 flex-col" aria-busy="true" aria-label="Loading board">
      <div className="flex h-14 shrink-0 items-center gap-3 px-4">
        <div className="skeleton h-6 w-44 rounded" />
        <div className="skeleton h-6 w-6 rounded" />
        <div className="flex-1" />
        <div className="skeleton h-7 w-28 rounded" />
        <div className="skeleton h-7 w-7 rounded-full" />
        <div className="skeleton h-7 w-7 rounded-full" />
      </div>
      <div className="flex min-h-0 flex-1 items-start gap-3 overflow-hidden px-3 pt-3">
        {lists.map((cards, i) => (
          <div
            key={i}
            className="animate-pop-in w-[272px] shrink-0 rounded-xl bg-[var(--color-list)] p-2 shadow-[var(--shadow-card)]"
            style={{ animationDelay: `${i * 60}ms` }}
          >
            <div className="skeleton mx-2 mt-1.5 mb-3 h-4 w-24 rounded" />
            <div className="flex flex-col gap-2">
              {cards.map((h, j) => (
                <div key={j} className="skeleton rounded-lg" style={{ height: h, animationDelay: `${(i + j) * 90}ms` }} />
              ))}
            </div>
            <div className="skeleton mx-2 mt-3 mb-1 h-4 w-20 rounded" />
          </div>
        ))}
      </div>
    </div>
  );
}

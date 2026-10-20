"use client";

import { SortableContext, useSortable, verticalListSortingStrategy } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { AnimatePresence, motion } from "framer-motion";
import { memo, useCallback, useEffect, useRef, useState } from "react";

import { api } from "~/trpc/react";

import { AutoTextarea, Button, IconButton, Icon, MenuItem, MenuSep, Popover, inputCls, usePopoverState } from "../ui";
import { rememberLocal, shouldAppear } from "./appear";
import { CardFront } from "./card-front";
import { type BoardData, type CardData, type ListData } from "./types";

export const SortableCard = memo(function SortableCard({
  card,
  boardId,
  onOpen,
  onQuickEdit,
  onHover,
  hidden,
  readOnly,
}: {
  card: CardData;
  boardId: string;
  onOpen: (id: string) => void;
  onQuickEdit: (card: CardData, el: HTMLElement) => void;
  onHover: (id: string | null) => void;
  hidden: boolean;
  readOnly: boolean;
}) {
  const open = useCallback(() => onOpen(card.id), [onOpen, card.id]);
  const quickEdit = useCallback((el: HTMLElement) => onQuickEdit(card, el), [onQuickEdit, card]);
  const { setNodeRef, attributes, listeners, transform, transition, isDragging } = useSortable({
    id: `card:${card.id}`,
    data: { type: "card", card },
    // Observers can't move cards; don't let them pick one up at all.
    disabled: readOnly,
  });
  // Computed once per mount so re-renders don't restart the animation.
  const [appear] = useState(() => shouldAppear(card.id, card.title, card.createdAt));
  if (hidden) return null;
  return (
    <div
      ref={setNodeRef}
      data-card
      data-card-id={card.id}
      style={{ transform: CSS.Translate.toString(transform), transition }}
      {...attributes}
      {...listeners}
      onMouseEnter={() => onHover(card.id)}
      onMouseLeave={() => onHover(null)}
      className={`outline-none ${appear ? "animate-pop-in" : ""}`}
    >
      <CardFront card={card} boardId={boardId} dragging={isDragging} onOpen={open} onQuickEdit={readOnly ? undefined : quickEdit} readOnly={readOnly} />
    </div>
  );
});

export const ListColumn = memo(function ListColumn({
  list,
  board,
  cards,
  isVisible,
  onOpenCard,
  onQuickEdit,
  onHoverCard,
  composerAt,
  onComposer,
  readOnly,
}: {
  list: ListData;
  board: BoardData;
  cards: CardData[];
  isVisible: (c: CardData) => boolean;
  onOpenCard: (id: string) => void;
  onQuickEdit: (card: CardData, el: HTMLElement) => void;
  onHoverCard: (id: string | null) => void;
  composerAt: "top" | "bottom" | null;
  onComposer: (listId: string, where: "top" | "bottom" | null) => void;
  readOnly: boolean;
}) {
  const { setNodeRef, attributes, listeners, transform, transition, isDragging } = useSortable({
    id: `list:${list.id}`,
    data: { type: "list", list },
    disabled: readOnly,
  });
  const [collapsed, setCollapsed] = useCollapsed(list.id);
  const setComposerAt = (where: "top" | "bottom" | null) => onComposer(list.id, where);
  const [appear] = useState(() => shouldAppear(list.id, list.name, list.createdAt));

  if (isDragging) {
    return (
      <div
        ref={setNodeRef}
        style={{ transform: CSS.Translate.toString(transform), transition }}
        className="w-[272px] shrink-0 self-stretch rounded-xl bg-black/20"
      />
    );
  }

  if (collapsed) {
    return (
      <div
        ref={setNodeRef}
        style={{ transform: CSS.Translate.toString(transform), transition }}
        {...attributes}
        {...listeners}
        onClick={() => setCollapsed(false)}
        className="flex w-12 shrink-0 cursor-pointer flex-col items-center gap-2 self-start rounded-xl bg-[var(--color-list)] py-3 shadow-[var(--shadow-card)] hover:bg-[var(--color-neutral-bold)]"
      >
        <Icon name="collapse" size={14} className="text-[var(--color-text-subtle)]" />
        <span className="text-sm font-semibold [writing-mode:vertical-rl]">{list.name}</span>
        <span className="text-xs text-[var(--color-text-subtle)] [writing-mode:vertical-rl]">{cards.length}</span>
      </div>
    );
  }

  return (
    <div
      ref={setNodeRef}
      style={{ transform: CSS.Translate.toString(transform), transition }}
      className={`flex max-h-full w-[272px] shrink-0 flex-col self-start rounded-xl bg-[var(--color-list)] pb-2 shadow-[var(--shadow-card)] ${appear ? "animate-pop-in" : ""}`}
    >
      <div {...attributes} {...listeners} className="flex cursor-pointer items-start gap-1 px-2 pt-2 pb-1 outline-none">
        <ListTitle list={list} boardId={board.id} readOnly={readOnly} />
        <span className="flex h-8 items-center px-1 text-sm text-[var(--color-text-subtle)] tabular-nums">{cards.length}</span>
        <IconButton
          className="text-[var(--color-text-subtle)]"
          onClick={() => setCollapsed(true)}
          aria-label="Collapse list"
          title="Collapse list"
        >
          <Icon name="collapseIn" size={16} />
        </IconButton>
        {!readOnly && <ListMenu list={list} board={board} onAddCard={() => setComposerAt("top")} />}
      </div>

      <div className="list-scroll flex min-h-0 flex-1 flex-col gap-2 overflow-x-hidden overflow-y-auto px-2 pt-0.5 pb-0.5">
        {composerAt === "top" && <CardComposer listId={list.id} boardId={board.id} where="top" onClose={() => setComposerAt(null)} />}
        <SortableContext items={cards.map((c) => `card:${c.id}`)} strategy={verticalListSortingStrategy}>
          {cards.map((c) => (
            <SortableCard
              key={c.id}
              card={c}
              boardId={board.id}
              hidden={!isVisible(c)}
              onOpen={onOpenCard}
              onQuickEdit={onQuickEdit}
              onHover={onHoverCard}
              readOnly={readOnly}
            />
          ))}
        </SortableContext>
        {composerAt === "bottom" && <CardComposer listId={list.id} boardId={board.id} where="bottom" onClose={() => setComposerAt(null)} />}
      </div>

      {composerAt !== "bottom" && !readOnly && (
        <div className="px-2 pt-2">
          <button
            onClick={() => setComposerAt("bottom")}
            className="flex h-8 w-full items-center gap-2 rounded-lg px-2 text-left text-sm font-medium text-[var(--color-text-subtle)] transition-colors hover:bg-[var(--color-neutral-hover)] hover:text-[var(--color-text)]"
          >
            <Icon name="plus" /> Add a card
          </button>
        </div>
      )}
    </div>
  );
});

function useCollapsed(listId: string) {
  const key = `hackban:collapsed:${listId}`;
  const [v, setV] = useState(false);
  useEffect(() => {
    try {
      setV(localStorage.getItem(key) === "1");
    } catch {}
  }, [key]);
  const set = (next: boolean) => {
    setV(next);
    try {
      if (next) localStorage.setItem(key, "1");
      else localStorage.removeItem(key);
    } catch {}
  };
  return [v, set] as const;
}

function ListTitle({ list, boardId, readOnly }: { list: ListData; boardId: string; readOnly: boolean }) {
  const [editing, setEditing] = useState(false);
  const [name, setName] = useState(list.name);
  const utils = api.useUtils();
  const rename = api.list.update.useMutation({
    onMutate: ({ name }) =>
      utils.board.get.setData({ id: boardId }, (b) => b && { ...b, lists: b.lists.map((l) => (l.id === list.id ? { ...l, name: name! } : l)) }),
    onSettled: () => utils.board.get.invalidate({ id: boardId }),
  });
  useEffect(() => setName(list.name), [list.name]);
  const save = () => {
    setEditing(false);
    const n = name.trim();
    if (n && n !== list.name) rename.mutate({ id: list.id, name: n });
    else setName(list.name);
  };
  if (editing) {
    return (
      <AutoTextarea
        autoFocus
        onFocus={(e) => e.currentTarget.select()}
        value={name}
        onChange={(e) => setName(e.target.value.replace(/\n/g, ""))}
        onBlur={save}
        onKeyDown={(e) => {
          if (e.key === "Enter") {
            e.preventDefault();
            save();
          }
          if (e.key === "Escape") {
            setName(list.name);
            setEditing(false);
          }
        }}
        onPointerDown={(e) => e.stopPropagation()}
        className="min-h-8 flex-1 rounded-[3px] bg-[var(--color-surface)] px-2 py-1.5 text-sm font-semibold shadow-[inset_0_0_0_2px_var(--color-focus)] outline-none"
      />
    );
  }
  return (
    <h2
      onClick={() => !readOnly && setEditing(true)}
      className="min-h-8 flex-1 cursor-pointer px-2 py-1.5 text-sm font-semibold break-words"
    >
      {list.name}
    </h2>
  );
}

function ListMenu({ list, board, onAddCard }: { list: ListData; board: BoardData; onAddCard: () => void }) {
  const p = usePopoverState();
  const [pane, setPane] = useState<"main" | "copy" | "move" | "moveCards" | "archiveCards">("main");
  const utils = api.useUtils();
  const inv = () => utils.board.get.invalidate({ id: board.id });
  const update = api.list.update.useMutation({
    onMutate: ({ closed }) => {
      if (closed) utils.board.get.setData({ id: board.id }, (b) => b && { ...b, lists: b.lists.filter((l) => l.id !== list.id) });
    },
    onSettled: inv,
  });
  const copy = api.list.copy.useMutation({ onSettled: inv });
  const move = api.list.move.useMutation({ onSettled: () => utils.board.get.invalidate() });
  const moveAll = api.list.moveAllCards.useMutation({ onSettled: inv });
  const archiveAll = api.list.archiveAllCards.useMutation({ onSettled: inv });
  const { data: workspaces } = api.workspace.list.useQuery(undefined, { enabled: pane === "move" });
  const [copyName, setCopyName] = useState(list.name);
  const [moveBoard, setMoveBoard] = useState(board.id);
  const [movePos, setMovePos] = useState(board.lists.findIndex((l) => l.id === list.id));
  const { data: targetBoard } = api.board.get.useQuery({ id: moveBoard }, { enabled: pane === "move" });

  const close = () => {
    p.close();
    setPane("main");
  };
  const titles = { main: "List actions", copy: "Copy list", move: "Move list", moveCards: "Move all cards in list", archiveCards: "Archive all cards in this list?" };

  return (
    <>
      <IconButton onClick={p.toggle} className="text-[var(--color-text-subtle)]" aria-label="List actions">
        <Icon name="more" />
      </IconButton>
      <Popover anchor={p.anchor} open={p.open} onClose={close} title={titles[pane]} onBack={pane !== "main" ? () => setPane("main") : undefined}>
        {pane === "main" && (
          <>
            <MenuItem onClick={() => { onAddCard(); close(); }}>Add card</MenuItem>
            <MenuItem onClick={() => setPane("copy")}>Copy list</MenuItem>
            <MenuItem onClick={() => setPane("move")}>Move list</MenuItem>
            <MenuItem onClick={() => setPane("moveCards")}>Move all cards in this list</MenuItem>
            <MenuSep />
            <MenuItem onClick={() => setPane("archiveCards")}>Archive all cards in this list</MenuItem>
            <MenuItem onClick={() => { update.mutate({ id: list.id, closed: true }); close(); }}>Archive this list</MenuItem>
          </>
        )}
        {pane === "copy" && (
          <>
            <label className="mb-1 block text-xs font-bold text-[var(--color-text-subtle)]">Name</label>
            <AutoTextarea autoFocus className={inputCls} value={copyName} onChange={(e) => setCopyName(e.target.value)} />
            <Button variant="primary" className="mt-3" onClick={() => { copy.mutate({ id: list.id, name: copyName.trim() || list.name }); close(); }}>
              Create list
            </Button>
          </>
        )}
        {pane === "move" && (
          <>
            <label className="mb-1 block text-xs font-bold text-[var(--color-text-subtle)]">Board</label>
            <select className={inputCls} value={moveBoard} onChange={(e) => { setMoveBoard(e.target.value); setMovePos(0); }}>
              {workspaces?.flatMap((w) => w.boards).map((b) => <option key={b.id} value={b.id}>{b.name}{b.id === board.id ? " (current)" : ""}</option>)}
            </select>
            <label className="mt-2 mb-1 block text-xs font-bold text-[var(--color-text-subtle)]">Position</label>
            <select className={inputCls} value={movePos} onChange={(e) => setMovePos(Number(e.target.value))}>
              {Array.from({ length: (targetBoard?.lists.filter((l) => l.id !== list.id).length ?? 0) + 1 }, (_, i) => (
                <option key={i} value={i}>{i + 1}</option>
              ))}
            </select>
            <Button
              variant="primary"
              className="mt-3"
              onClick={() => {
                const others = targetBoard?.lists.filter((l) => l.id !== list.id) ?? [];
                move.mutate({ id: list.id, boardId: moveBoard, afterId: movePos === 0 ? null : others[movePos - 1]?.id ?? null });
                close();
              }}
            >
              Move
            </Button>
          </>
        )}
        {pane === "moveCards" && (
          <>
            {board.lists.map((l) => (
              <MenuItem key={l.id} disabled={l.id === list.id} onClick={() => { moveAll.mutate({ id: list.id, toListId: l.id }); close(); }}>
                {l.name} {l.id === list.id && "(current)"}
              </MenuItem>
            ))}
          </>
        )}
        {pane === "archiveCards" && (
          <>
            <p className="mb-3 text-sm">This will remove all the cards in this list from the board. To view archived cards and bring them back, click “Menu” &gt; “Archived items.”</p>
            <Button variant="danger" className="w-full" onClick={() => { archiveAll.mutate({ id: list.id }); close(); }}>Archive all</Button>
          </>
        )}
      </Popover>
    </>
  );
}

export function CardComposer({ listId, boardId, where, onClose }: { listId: string; boardId: string; where: "top" | "bottom"; onClose: () => void }) {
  const [title, setTitle] = useState("");
  const ref = useRef<HTMLDivElement>(null);
  const utils = api.useUtils();
  const create = api.card.create.useMutation({
    onMutate: async ({ title }) => {
      rememberLocal(title);
      await utils.board.get.cancel({ id: boardId });
      const temp: CardData = {
        id: `temp-${Math.random()}`,
        listId,
        title,
        description: "",
        pos: "",
        start: null,
        due: null,
        dueComplete: false,
        coverColor: null,
        coverAttachmentId: null,
        coverSize: "normal",
        closed: false,
        trelloId: null,
        shortId: 0,
        createdAt: new Date(),
        updatedAt: new Date(),
        labels: [],
        members: [],
        _count: { comments: 0, attachments: 0 },
        checkTotal: 0,
        checkDone: 0,
        coverUrl: null,
        watching: false,
      };
      utils.board.get.setData({ id: boardId }, (b) =>
        b && {
          ...b,
          lists: b.lists.map((l) => (l.id === listId ? { ...l, cards: where === "top" ? [temp, ...l.cards] : [...l.cards, temp] } : l)),
        },
      );
    },
    onSettled: () => utils.board.get.invalidate({ id: boardId }),
  });
  useEffect(() => {
    ref.current?.scrollIntoView({ block: "nearest" });
  }, [title]);
  useEffect(() => {
    const onDown = (e: MouseEvent) => {
      if (!ref.current?.contains(e.target as Node)) {
        submit(false);
        onClose();
      }
    };
    document.addEventListener("mousedown", onDown);
    return () => document.removeEventListener("mousedown", onDown);
  });
  const submit = (keepOpen = true) => {
    const t = title.trim();
    if (t) create.mutate({ listId, title: t, afterId: where === "top" ? null : undefined });
    setTitle("");
    if (!keepOpen) onClose();
  };
  return (
    <motion.div ref={ref} initial={{ opacity: 0, y: -4 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.12 }}>
      <AutoTextarea
        autoFocus
        minRows={3}
        value={title}
        placeholder="Enter a title for this card…"
        onChange={(e) => setTitle(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter") {
            e.preventDefault();
            submit();
          }
          if (e.key === "Escape") onClose();
        }}
        className="block w-full rounded-lg bg-[var(--color-surface)] px-3 py-2 text-sm shadow-[var(--shadow-card)] outline-none"
      />
      <div className="mt-2 flex items-center gap-1">
        <Button variant="primary" onClick={() => submit()}>Add card</Button>
        <IconButton onClick={onClose} aria-label="Cancel"><Icon name="close" /></IconButton>
      </div>
    </motion.div>
  );
}

export function ListComposer({ boardId }: { boardId: string }) {
  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");
  const utils = api.useUtils();
  const create = api.list.create.useMutation({
    onMutate: async ({ name }) => {
      rememberLocal(name);
      await utils.board.get.cancel({ id: boardId });
      utils.board.get.setData({ id: boardId }, (b) =>
        b && { ...b, lists: [...b.lists, { id: `temp-${Math.random()}`, boardId, name, pos: "", closed: false, trelloId: null, createdAt: new Date(), cards: [] }] },
      );
    },
    onSettled: () => utils.board.get.invalidate({ id: boardId }),
  });
  const submit = () => {
    if (name.trim()) create.mutate({ boardId, name: name.trim() });
    setName("");
  };
  return (
    <div className="w-[272px] shrink-0 self-start">
      <AnimatePresence initial={false} mode="wait">
        {open ? (
          <motion.div
            key="form"
            initial={{ opacity: 0.6, scale: 0.98 }}
            animate={{ opacity: 1, scale: 1 }}
            transition={{ duration: 0.1 }}
            className="rounded-xl bg-[var(--color-list)] p-2 shadow-[var(--shadow-card)]"
          >
            <input
              autoFocus
              value={name}
              placeholder="Enter list title…"
              onChange={(e) => setName(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") submit();
                if (e.key === "Escape") setOpen(false);
              }}
              className={inputCls + " font-semibold"}
            />
            <div className="mt-2 flex items-center gap-1">
              <Button variant="primary" onClick={submit}>Add list</Button>
              <IconButton onClick={() => setOpen(false)} aria-label="Cancel"><Icon name="close" /></IconButton>
            </div>
          </motion.div>
        ) : (
          <motion.button
            key="btn"
            onClick={() => setOpen(true)}
            className="flex h-11 w-full items-center gap-2 rounded-xl bg-white/25 px-3 text-sm font-medium text-white transition-colors hover:bg-white/35"
          >
            <Icon name="plus" /> Add another list
          </motion.button>
        )}
      </AnimatePresence>
    </div>
  );
}

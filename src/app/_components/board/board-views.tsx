"use client";

import { format } from "date-fns";
import { useMemo, useState } from "react";

import { sortCardLabels } from "~/lib/labels";
import { api } from "~/trpc/react";

import { Avatar, Icon, dueState, labelStyle } from "../ui";
import { REPEAT_SHOW_DONE_MS } from "./card-front";
import { CardPopover, type PopKind } from "./card-popovers";
import { useCreateCard } from "./list-column";
import { fieldsPatch, usePatchCard } from "./optimistic";
import { type BoardData, type CardData, type ListData } from "./types";

type ViewProps = {
  board: BoardData;
  isVisible: (c: CardData) => boolean;
  onOpenCard: (id: string) => void;
  onHoverCard: (id: string | null) => void;
  readOnly: boolean;
};

const fullDate = (d: Date) => format(d, d.getFullYear() === new Date().getFullYear() ? "MMM d" : "MMM d, yyyy");

// ---------- shared ----------

type Fields = Partial<Pick<CardData, "title" | "start" | "due" | "dueComplete">>;

/** Optimistic card edits: the view updates at once and the server confirms in the background. */
function useUpdateCard(boardId: string) {
  const utils = api.useUtils();
  const patch = usePatchCard(boardId);
  const m = api.card.update.useMutation({
    onSettled: (_d, _e, v) =>
      // repeating cards read as done for a beat before rolling to their next date
      setTimeout(() => {
        void utils.board.get.invalidate({ id: boardId });
        void utils.card.get.invalidate({ id: v.id });
      }, v.dueComplete ? REPEAT_SHOW_DONE_MS : 0),
  });
  return (id: string, fields: Fields) => {
    patch(id, fieldsPatch(fields));
    m.mutate({ id, ...fields });
  };
}

/** One shared popover (members, labels, dates, move) for whichever cell was clicked. */
type Pop = { id: string; kind: PopKind; el: HTMLElement } | null;
function CellPopover({ pop, board, onClose }: { pop: Pop; board: BoardData; onClose: () => void }) {
  const { data } = api.card.get.useQuery({ id: pop?.id ?? "" }, { enabled: !!pop });
  if (!pop || data?.id !== pop.id) return null;
  return <CardPopover kind={pop.kind} anchor={{ el: pop.el }} onClose={onClose} card={data} board={board} />;
}

function useGroups(board: BoardData, isVisible: (c: CardData) => boolean) {
  const [collapsed, setCollapsed] = useState<Set<string>>(() => new Set());
  const groups = useMemo(() => board.lists.map((list) => ({ list, cards: list.cards.filter(isVisible) })), [board, isVisible]);
  const toggle = (id: string) =>
    setCollapsed((s) => {
      const n = new Set(s);
      if (!n.delete(id)) n.add(id);
      return n;
    });
  return { groups, collapsed, toggle };
}

const listDot = (color: string | null) => ({ background: color ? labelStyle(color).background : "var(--color-text-subtlest)" });

function GroupHeader({ list, count, collapsed, onToggle }: { list: ListData; count: number; collapsed: boolean; onToggle: () => void }) {
  return (
    <button onClick={onToggle} aria-expanded={!collapsed} className="flex h-10 items-center gap-2 px-3 text-sm font-semibold whitespace-nowrap">
      <Icon name="chevronDown" size={16} className={`text-[var(--color-text-subtle)] transition-transform ${collapsed ? "-rotate-90" : ""}`} />
      <span className="h-3 w-3 shrink-0 rounded-full" style={listDot(list.color)} />
      {list.name}
      <span className="rounded-full bg-[var(--color-neutral)] px-1.5 text-xs leading-5 font-medium text-[var(--color-text-subtle)]">{count}</span>
    </button>
  );
}

function StatusToggle({ card, readOnly, onToggle }: { card: CardData; readOnly: boolean; onToggle: () => void }) {
  return (
    <button
      onClick={onToggle}
      disabled={readOnly}
      aria-label={card.dueComplete ? "Mark incomplete" : "Mark complete"}
      title={card.dueComplete ? "Complete" : "Open"}
      className={`shrink-0 rounded-full transition-transform enabled:hover:scale-110 ${card.dueComplete ? "text-[var(--color-success)]" : "text-[var(--color-text-subtle)] enabled:hover:text-[var(--color-success)]"}`}
    >
      <Icon name={card.dueComplete ? "checkCircle" : "issue"} />
    </button>
  );
}

// ---------- Table ----------

type SortKey = "title" | "start" | "due";
const time = (d: Date | null) => d?.getTime() ?? null;
const cellCls = "border-r border-b border-[var(--color-border)] p-0 last:border-r-0";
const headCls = `${cellCls} h-9 bg-[var(--color-surface)] px-2 text-left text-xs font-semibold text-[var(--color-text-subtle)]`;
// Cells are buttons that fill the cell, like GitHub's: click (or Enter) to edit.
const cellBtn = "flex h-9 w-full min-w-0 items-center gap-1.5 px-2 text-left outline-none enabled:hover:bg-[var(--color-neutral)] focus-visible:shadow-[inset_0_0_0_2px_var(--color-focus)]";

export function TableView({ board, isVisible, onOpenCard, onHoverCard, readOnly }: ViewProps) {
  const { groups, collapsed, toggle } = useGroups(board, isVisible);
  const update = useUpdateCard(board.id);
  const [pop, setPop] = useState<Pop>(null);
  const [editing, setEditing] = useState<string | null>(null);
  const [adding, setAdding] = useState<string | null>(null);
  const [sort, setSort] = useState<{ key: SortKey; dir: 1 | -1 } | null>(null);
  const sorted = (cards: CardData[]) => {
    if (!sort) return cards;
    const { key, dir } = sort;
    return [...cards].sort((a, b) => {
      if (key === "title") return a.title.localeCompare(b.title, undefined, { numeric: true, sensitivity: "base" }) * dir;
      const x = time(a[key]);
      const y = time(b[key]);
      // undated cards sink to the bottom whichever way the dates run
      if (x === null || y === null) return Number(x === null) - Number(y === null);
      return (x - y) * dir;
    });
  };
  // ascending, descending, then back to board order
  const cycle = (key: SortKey) => setSort((s) => (s?.key !== key ? { key, dir: 1 } : s.dir === 1 ? { key, dir: -1 } : null));
  const sortHead = (k: SortKey, label: string) => (
    <button onClick={() => cycle(k)} className="flex w-full items-center gap-1 hover:text-[var(--color-text)]">
      {label}
      {sort?.key === k && <Icon name="sort" size={12} className={sort.dir === -1 ? "rotate-180" : ""} />}
    </button>
  );
  const ariaSort = (k: SortKey) => (sort?.key === k ? (sort.dir === 1 ? "ascending" : "descending") : undefined);
  const openPop = (id: string, kind: PopKind) => (e: React.MouseEvent<HTMLElement>) => setPop({ id, kind, el: e.currentTarget });
  const listOf = new Map(board.lists.map((l) => [l.id, l]));
  let n = 0;

  return (
    <div className="min-h-0 flex-1 overflow-auto bg-[var(--color-surface)] text-[var(--color-text)]">
      <table className="w-full min-w-[1000px] table-fixed border-separate border-spacing-0 text-sm">
        <colgroup>
          <col className="w-12" />
          <col />
          <col className="w-[180px]" />
          <col className="w-[160px]" />
          <col className="w-[200px]" />
          <col className="w-[120px]" />
          <col className="w-[120px]" />
        </colgroup>
        <thead className="sticky top-0 z-10">
          <tr>
            <th className={headCls} />
            <th className={headCls} aria-sort={ariaSort("title")}>{sortHead("title", "Title")}</th>
            <th className={headCls}>Assignees</th>
            <th className={headCls}>List</th>
            <th className={headCls}>Labels</th>
            <th className={headCls} aria-sort={ariaSort("start")}>{sortHead("start", "Start date")}</th>
            <th className={headCls} aria-sort={ariaSort("due")}>{sortHead("due", "Due date")}</th>
          </tr>
        </thead>
        {groups.map(({ list, cards }) => (
          <tbody key={list.id}>
            <tr>
              <td colSpan={7} className="border-b border-[var(--color-border)] bg-[var(--color-surface)] p-0">
                <GroupHeader list={list} count={cards.length} collapsed={collapsed.has(list.id)} onToggle={() => toggle(list.id)} />
              </td>
            </tr>
            {!collapsed.has(list.id) &&
              sorted(cards).map((c) => {
                const late = ["late", "overdue"].includes(dueState(c.due, c.dueComplete) ?? "");
                const cardList = listOf.get(c.listId) ?? list;
                return (
                  <tr key={c.id} data-card-id={c.id} onMouseEnter={() => onHoverCard(c.id)} onMouseLeave={() => onHoverCard(null)} className="group hover:bg-[var(--color-surface-hover)]">
                    <td className={`${cellCls} px-2 text-right text-xs text-[var(--color-text-subtlest)] tabular-nums`}>{++n}</td>
                    <td className={cellCls}>
                      <div className="flex h-9 min-w-0 items-center gap-2 px-2">
                        <StatusToggle card={c} readOnly={readOnly} onToggle={() => update(c.id, { dueComplete: !c.dueComplete })} />
                        {editing === c.id ? (
                          <TitleInput
                            initial={c.title}
                            onDone={(t) => {
                              setEditing(null);
                              if (t && t !== c.title) update(c.id, { title: t });
                            }}
                          />
                        ) : (
                          <>
                            <button onClick={() => onOpenCard(c.id)} title={c.title} className={`truncate text-left hover:text-[var(--color-brand)] hover:underline ${c.dueComplete ? "text-[var(--color-text-subtle)]" : ""}`}>
                              {c.title}
                            </button>
                            {!readOnly && (
                              <button onClick={() => setEditing(c.id)} aria-label="Edit title" className="ml-auto shrink-0 rounded p-1 text-[var(--color-text-subtle)] opacity-0 group-hover:opacity-100 hover:bg-[var(--color-neutral)] focus-visible:opacity-100">
                                <Icon name="edit" size={14} />
                              </button>
                            )}
                          </>
                        )}
                      </div>
                    </td>
                    <td className={cellCls}>
                      <button disabled={readOnly} onClick={openPop(c.id, "members")} className={cellBtn} aria-label="Edit assignees">
                        <span className="flex shrink-0 -space-x-1.5">
                          {c.members.slice(0, 3).map((m) => (
                            <Avatar key={m.userId} user={m.user} size={20} className="ring-2 ring-[var(--color-surface)]" />
                          ))}
                        </span>
                        <span className="truncate text-xs text-[var(--color-text-subtle)]">
                          {c.members.length === 1 ? c.members[0]!.user.name : c.members.length > 3 ? `+${c.members.length - 3}` : ""}
                        </span>
                      </button>
                    </td>
                    <td className={cellCls}>
                      <button disabled={readOnly} onClick={openPop(c.id, "move")} className={cellBtn} aria-label="Move to list">
                        <span className="h-2.5 w-2.5 shrink-0 rounded-full" style={listDot(cardList.color)} />
                        <span className="truncate">{cardList.name}</span>
                      </button>
                    </td>
                    <td className={cellCls}>
                      <button disabled={readOnly} onClick={openPop(c.id, "labels")} className={`${cellBtn} overflow-hidden`} aria-label="Edit labels">
                        {sortCardLabels(c.labels).map(({ label }) => (
                          <span key={label.id} title={label.name} className="h-5 max-w-[120px] min-w-6 shrink-0 truncate rounded-full px-2 text-xs leading-5 font-medium" style={labelStyle(label.color)}>
                            {label.name}
                          </span>
                        ))}
                      </button>
                    </td>
                    <td className={cellCls}>
                      <button disabled={readOnly} onClick={openPop(c.id, "dates")} className={`${cellBtn} text-[var(--color-text-subtle)]`} aria-label="Edit start date">
                        {c.start && fullDate(c.start)}
                      </button>
                    </td>
                    <td className={cellCls}>
                      <button disabled={readOnly} onClick={openPop(c.id, "dates")} className={`${cellBtn} ${late ? "font-medium text-[var(--color-danger)]" : "text-[var(--color-text-subtle)]"}`} aria-label="Edit due date">
                        {c.due && fullDate(c.due)}
                      </button>
                    </td>
                  </tr>
                );
              })}
            {!collapsed.has(list.id) && !readOnly && (
              <tr>
                <td className={cellCls} />
                <td colSpan={6} className={cellCls}>
                  {adding === list.id ? (
                    <AddItem listId={list.id} boardId={board.id} onClose={() => setAdding(null)} />
                  ) : (
                    <button onClick={() => setAdding(list.id)} className={`${cellBtn} text-[var(--color-text-subtle)] hover:text-[var(--color-text)]`}>
                      <Icon name="plus" size={14} /> Add item
                    </button>
                  )}
                </td>
              </tr>
            )}
          </tbody>
        ))}
      </table>
      {!groups.some((g) => g.cards.length) && <p className="py-10 text-center text-sm text-[var(--color-text-subtle)]">No cards match these filters.</p>}
      <CellPopover pop={pop} board={board} onClose={() => setPop(null)} />
    </div>
  );
}

const inlineInput = "h-7 w-full min-w-0 rounded-[3px] bg-[var(--color-surface)] px-1.5 text-sm shadow-[inset_0_0_0_2px_var(--color-focus)] outline-none";

function TitleInput({ initial, onDone }: { initial: string; onDone: (title: string | null) => void }) {
  const [v, setV] = useState(initial);
  return (
    <input
      autoFocus
      onFocus={(e) => e.currentTarget.select()}
      value={v}
      onChange={(e) => setV(e.target.value)}
      onBlur={() => onDone(v.trim() || null)}
      onKeyDown={(e) => {
        if (e.key === "Enter") e.currentTarget.blur();
        if (e.key === "Escape") onDone(null);
      }}
      className={inlineInput}
    />
  );
}

/** GitHub's "+ Add item": type a title, Enter adds it and keeps the row open for the next one. */
function AddItem({ listId, boardId, onClose }: { listId: string; boardId: string; onClose: () => void }) {
  const [title, setTitle] = useState("");
  const create = useCreateCard(listId, boardId, "bottom");
  return (
    <div className="flex h-9 items-center px-2">
      <input
        autoFocus
        value={title}
        placeholder="Type a title and press Enter"
        onChange={(e) => setTitle(e.target.value)}
        onBlur={() => !title.trim() && onClose()}
        onKeyDown={(e) => {
          if (e.key === "Escape") onClose();
          if (e.key === "Enter" && title.trim()) {
            create.mutate({ listId, title: title.trim() });
            setTitle("");
          }
        }}
        className={inlineInput}
      />
    </div>
  );
}

"use client";

import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";

import { api } from "~/trpc/react";

import { Avatar, Icon, Popover, inputCls, labelStyle, usePopoverState } from "../ui";
import { MemberAvatars, ShareDialog } from "./members";
import { filterActive, type BoardData, type Filters } from "./types";

const VIS = {
  private: { icon: "lock", label: "Private", desc: "Only board members can see this board. Workspace admins can close the board or remove members." },
  workspace: { icon: "people", label: "Workspace", desc: "All members of the workspace can see and edit this board." },
  public: { icon: "globe", label: "Public", desc: "Anyone on the internet can see this board. Only board members can edit." },
} as const;

const hdrBtn = "flex h-8 items-center gap-1.5 rounded-[3px] px-2.5 text-sm font-medium text-white transition-colors hover:bg-white/20";

export function BoardHeader({
  board,
  meId,
  filters,
  setFilters,
  onMenu,
}: {
  board: BoardData;
  meId: string;
  filters: Filters;
  setFilters: (f: Filters) => void;
  onMenu: () => void;
}) {
  const utils = api.useUtils();
  const vis = usePopoverState();
  const filter = usePopoverState();
  const [shareOpen, setShareOpen] = useState(false);
  const closeShare = useCallback(() => setShareOpen(false), []);
  const update = api.board.update.useMutation({
    onMutate: (d) => utils.board.get.setData({ id: board.id }, (b) => b && { ...b, ...Object.fromEntries(Object.entries(d).filter(([, v]) => v !== undefined)) }),
    onSettled: () => {
      void utils.board.get.invalidate({ id: board.id });
      void utils.workspace.list.invalidate();
    },
  });
  const star = api.board.star.useMutation({
    onMutate: ({ starred }) => utils.board.get.setData({ id: board.id }, (b) => b && { ...b, starred }),
    onSettled: () => utils.workspace.list.invalidate(),
  });
  const v = VIS[board.visibility as keyof typeof VIS] ?? VIS.workspace;
  const active = filterActive(filters);
  const count = filters.members.length + filters.labels.length + filters.due.length + (filters.q ? 1 : 0);
  const readOnly = board.myRole === "observer";
  const mine = filters.members.includes(meId);

  return (
    <div className="flex h-14 shrink-0 items-center gap-1 bg-black/30 px-3">
      <BoardName board={board} readOnly={readOnly} onSave={(name) => update.mutate({ id: board.id, name })} />
      <button
        onClick={() => star.mutate({ id: board.id, starred: !board.starred })}
        className={`${hdrBtn} w-8 justify-center px-0 ${board.starred ? "text-[#f5cd47]" : ""}`}
        aria-label={board.starred ? "Unstar board" : "Star board"}
        aria-pressed={board.starred}
        title={board.starred ? "Click to unstar this board" : "Click to star this board"}
      >
        <Icon name={board.starred ? "star" : "starOutline"} className="transition-transform active:scale-125" />
      </button>
      <button onClick={vis.toggle} className={`${hdrBtn} w-8 justify-center px-0`} title={v.label}>
        <Icon name={v.icon} />
      </button>
      <div className="flex-1" />
      <button
        onClick={() => setFilters({ ...filters, members: mine ? filters.members.filter((m) => m !== meId) : [...filters.members, meId] })}
        className={`${hdrBtn} ${mine ? "bg-[#dcdfe4] text-[#172b4d] hover:bg-white" : ""}`}
        title="Only show cards assigned to me (q)"
      >
        <Icon name="user" /> My cards
      </button>
      <button onClick={filter.toggle} className={`${hdrBtn} ${active ? "bg-[#dcdfe4] text-[#172b4d] hover:bg-white" : ""}`}>
        <Icon name="filter" /> Filters
        {active && <span className="rounded-full bg-[var(--color-brand)] px-1.5 text-xs text-[var(--color-on-brand)]">{count}</span>}
      </button>
      {/* Space is always reserved so the buttons to its left don't jump. */}
      <button
        onClick={() => setFilters({ q: "", members: [], labels: [], due: [] })}
        className={`${hdrBtn} ${active ? "" : "invisible"}`}
        tabIndex={active ? 0 : -1}
        aria-hidden={!active}
      >
        Clear all
      </button>
      <span className="mx-1 h-5 w-px bg-white/30" />
      <MemberAvatars
        board={board}
        meId={meId}
        onFilterMember={(id) => setFilters({ ...filters, members: filters.members.includes(id) ? filters.members : [...filters.members, id] })}
      />
      <button onClick={() => setShareOpen(true)} className="ml-2 flex h-8 items-center gap-1.5 rounded-[3px] bg-[var(--color-neutral-bold)] px-3 text-sm font-medium text-[var(--color-text)] hover:bg-[var(--color-surface)]">
        <Icon name="people" /> Share
      </button>
      <button onClick={onMenu} className={`${hdrBtn} w-8 justify-center px-0`} aria-label="Show menu">
        <Icon name="more" />
      </button>

      <Popover anchor={vis.anchor} open={vis.open} onClose={vis.close} title="Change visibility">
        {(Object.keys(VIS) as (keyof typeof VIS)[]).map((k) => (
          <button
            key={k}
            disabled={readOnly}
            onClick={() => {
              update.mutate({ id: board.id, visibility: k });
              vis.close();
            }}
            className="-mx-3 block w-[calc(100%+24px)] px-3 py-2 text-left hover:bg-[var(--color-neutral)]"
          >
            <span className="flex items-center gap-1.5 text-sm font-medium">
              <Icon name={VIS[k].icon} size={14} /> {VIS[k].label} {board.visibility === k && "✓"}
            </span>
            <span className="block text-xs text-[var(--color-text-subtle)]">{VIS[k].desc}</span>
          </button>
        ))}
      </Popover>

      <Popover anchor={filter.anchor} open={filter.open} onClose={filter.close} title="Filter" width={320} maxHeight={480}>
        <FilterPane board={board} meId={meId} filters={filters} setFilters={setFilters} />
      </Popover>

      <ShareDialog board={board} meId={meId} open={shareOpen} onClose={closeShare} />
    </div>
  );
}

function BoardName({ board, readOnly, onSave }: { board: BoardData; readOnly: boolean; onSave: (n: string) => void }) {
  const [editing, setEditing] = useState(false);
  const [name, setName] = useState(board.name);
  const measure = useRef<HTMLSpanElement>(null);
  const [w, setW] = useState(0);
  useEffect(() => setName(board.name), [board.name]);
  useLayoutEffect(() => setW(measure.current?.offsetWidth ?? 0), [name, editing]);
  const save = () => {
    setEditing(false);
    if (name.trim() && name.trim() !== board.name) onSave(name.trim());
    else setName(board.name);
  };
  return (
    <div className="relative">
      <span ref={measure} className="invisible absolute px-2.5 text-lg font-bold whitespace-pre">{name || " "}</span>
      {editing ? (
        <input
          autoFocus
          onFocus={(e) => e.currentTarget.select()}
          value={name}
          style={{ width: w + 4 }}
          onChange={(e) => setName(e.target.value)}
          onBlur={save}
          onKeyDown={(e) => {
            if (e.key === "Enter") save();
            if (e.key === "Escape") {
              setName(board.name);
              setEditing(false);
            }
          }}
          className="h-8 rounded-[3px] bg-[var(--color-surface)] px-2.5 text-lg font-bold text-[var(--color-text)] shadow-[inset_0_0_0_2px_var(--color-focus)] outline-none"
        />
      ) : (
        <h1 onClick={() => !readOnly && setEditing(true)} className="h-8 cursor-pointer rounded-[3px] px-2.5 text-lg leading-8 font-bold text-white hover:bg-white/20">
          {board.name}
        </h1>
      )}
    </div>
  );
}

function Check({ on, onChange, children }: { on: boolean; onChange: () => void; children: React.ReactNode }) {
  return (
    <label className="flex min-h-8 cursor-pointer items-center gap-2 rounded px-1 hover:bg-[var(--color-neutral)]">
      <input type="checkbox" checked={on} onChange={onChange} className="h-4 w-4 accent-[var(--color-brand)]" />
      {children}
    </label>
  );
}

const DUE = [
  ["overdue", "Overdue"],
  ["day", "Due today"],
  ["week", "Due this week"],
  ["none", "No dates"],
  ["complete", "Complete"],
] as const;

const MEMBERS_SHOWN = 5;

function FilterPane({ board, meId, filters, setFilters }: { board: BoardData; meId: string; filters: Filters; setFilters: (f: Filters) => void }) {
  const [allMembers, setAllMembers] = useState(false);
  const tog = <K extends "members" | "labels" | "due">(k: K, v: Filters[K][number]) => {
    const arr = filters[k] as string[];
    setFilters({ ...filters, [k]: arr.includes(v) ? arr.filter((x) => x !== v) : [...arr, v] });
  };
  // me first, then everyone else; selected members always stay visible when collapsed
  const members = [...board.members].sort((a, b) => Number(b.userId === meId) - Number(a.userId === meId));
  const shown = allMembers ? members : members.filter((m, i) => i < MEMBERS_SHOWN || filters.members.includes(m.userId));
  const heading = "mt-3 mb-1 text-[11px] font-semibold tracking-wide text-[var(--color-text-subtle)] uppercase";
  return (
    <div className="pb-1 text-sm">
      <input autoFocus className={inputCls} placeholder="Search cards…" value={filters.q} onChange={(e) => setFilters({ ...filters, q: e.target.value })} />
      <div className="mt-2 flex flex-wrap gap-1.5">
        <Chip on={filters.members.includes(meId)} onClick={() => tog("members", meId)}>
          <Icon name="user" size={12} /> Assigned to me
        </Chip>
        <Chip on={filters.due.includes("overdue")} onClick={() => tog("due", "overdue")}>Overdue</Chip>
        <Chip on={filters.due.includes("week")} onClick={() => tog("due", "week")}>Due this week</Chip>
      </div>

      <h3 className={heading}>Members</h3>
      {shown.map((m) => (
        <Check key={m.userId} on={filters.members.includes(m.userId)} onChange={() => tog("members", m.userId)}>
          <Avatar user={m.user} size={20} /> <span className="truncate">{m.user.name}</span>
          {m.userId === meId && <span className="text-xs text-[var(--color-text-subtlest)]">(you)</span>}
        </Check>
      ))}
      <Check on={filters.members.includes("none")} onChange={() => tog("members", "none")}>
        <span className="text-[var(--color-text-subtle)]">No members</span>
      </Check>
      {members.length > MEMBERS_SHOWN && (
        <button onClick={() => setAllMembers((v) => !v)} className="mt-0.5 px-1 text-xs font-medium text-[var(--color-brand)] hover:underline">
          {allMembers ? "Show fewer" : `Show all ${members.length} members`}
        </button>
      )}

      <h3 className={heading}>Due date</h3>
      <div className="flex flex-wrap gap-1.5">
        {DUE.map(([k, label]) => (
          <Chip key={k} on={filters.due.includes(k)} onClick={() => tog("due", k)}>{label}</Chip>
        ))}
      </div>

      <h3 className={heading}>Labels</h3>
      <div className="flex flex-wrap gap-1.5">
        {board.labels.map((l) => {
          const on = filters.labels.includes(l.id);
          return (
            <button
              key={l.id}
              onClick={() => tog("labels", l.id)}
              title={l.name || undefined}
              className={`h-6 max-w-full min-w-10 truncate rounded-[3px] px-2 text-xs font-medium transition ${on ? "ring-2 ring-[var(--color-focus)] ring-offset-1" : "opacity-80 hover:opacity-100"}`}
              style={labelStyle(l.color)}
            >
              {l.name}
            </button>
          );
        })}
        <Chip on={filters.labels.includes("none")} onClick={() => tog("labels", "none")}>No labels</Chip>
      </div>
    </div>
  );
}

function Chip({ on, onClick, children }: { on: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      onClick={onClick}
      className={`flex h-6 items-center gap-1 rounded-full px-2.5 text-xs font-medium transition-colors ${
        on ? "bg-[var(--color-brand)] text-[var(--color-on-brand)]" : "bg-[var(--color-neutral)] text-[var(--color-text)] hover:bg-[var(--color-neutral-hover)]"
      }`}
    >
      {children}
    </button>
  );
}

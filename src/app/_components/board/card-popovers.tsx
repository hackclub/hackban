"use client";

import {
  addDays,
  addMonths,
  eachDayOfInterval,
  endOfMonth,
  endOfWeek,
  format,
  isSameDay,
  isSameMonth,
  startOfMonth,
  startOfWeek,
} from "date-fns";
import { useRouter } from "next/navigation";
import { useRef, useState } from "react";

import { api, clientId, type RouterOutputs } from "~/trpc/react";

import { Avatar, Button, Icon, IconButton, MenuItem, Popover, coverColor, inputCls, usePopover } from "../ui";
import { Labels } from "./board-menu";
import { type BoardData } from "./types";

type Recurrence = "daily" | "weekdays" | "weekly" | "monthly" | "yearly";
export const RECURRENCE_OPTIONS: [Recurrence, string][] = [
  ["daily", "Daily"],
  ["weekdays", "Every weekday"],
  ["weekly", "Weekly"],
  ["monthly", "Monthly"],
  ["yearly", "Yearly"],
];

export type CardDetail = RouterOutputs["card"]["get"];
export type PopKind = "members" | "labels" | "checklist" | "dates" | "attachment" | "cover" | "move" | "copy";
type Anchor = Parameters<typeof Popover>[0]["anchor"];

const TITLES: Record<PopKind, string> = {
  members: "Members",
  labels: "Labels",
  checklist: "Add checklist",
  dates: "Dates",
  attachment: "Attach",
  cover: "Cover",
  move: "Move card",
  copy: "Copy card",
};

export function useCardInvalidate(cardId: string, boardId: string) {
  const utils = api.useUtils();
  return () => {
    void utils.card.get.invalidate({ id: cardId });
    void utils.board.get.invalidate({ id: boardId });
  };
}

export async function uploadFiles(cardId: string, files: File[]) {
  const fd = new FormData();
  for (const f of files) fd.append("file", f);
  const res = await fetch(`/api/cards/${cardId}/attachments`, { method: "POST", body: fd, headers: { "x-client-id": clientId } });
  if (!res.ok) throw new Error(await res.text());
}

export function CardPopover({
  kind,
  anchor,
  onClose,
  card,
  board,
}: {
  kind: PopKind | null;
  anchor: Anchor;
  onClose: () => void;
  card: CardDetail;
  board: BoardData;
}) {
  return (
    <Popover anchor={anchor} open={!!kind && !!anchor} onClose={onClose} title={kind ? TITLES[kind] : ""}>
      {kind === "members" && <MembersPane card={card} board={board} />}
      {kind === "labels" && <LabelsPane card={card} board={board} />}
      {kind === "checklist" && <ChecklistPane card={card} board={board} />}
      {kind === "dates" && <DatesPane card={card} board={board} />}
      {kind === "attachment" && <AttachPane card={card} board={board} />}
      {kind === "cover" && <CoverPane card={card} board={board} />}
      {kind === "move" && <MovePane card={card} board={board} />}
      {kind === "copy" && <CopyPane card={card} board={board} />}
    </Popover>
  );
}

function MembersPane({ card, board }: { card: CardDetail; board: BoardData }) {
  const [q, setQ] = useState("");
  const utils = api.useUtils();
  const inv = useCardInvalidate(card.id, board.id);
  const toggle = api.card.toggleMember.useMutation({
    onMutate: ({ userId, on }) => {
      const m = board.members.find((x) => x.userId === userId);
      utils.card.get.setData({ id: card.id }, (c) =>
        c && { ...c, members: on && m ? [...c.members, { cardId: c.id, userId, user: { ...m.user, username: m.user.username } }] : c.members.filter((x) => x.userId !== userId) },
      );
    },
    onSettled: inv,
  });
  const on = new Set(card.members.map((m) => m.userId));
  const matches = board.members.filter((m) => (m.user.name ?? "").toLowerCase().includes(q.toLowerCase()));
  return (
    <div>
      <input autoFocus className={inputCls} placeholder="Search members" value={q} onChange={(e) => setQ(e.target.value)} />
      {card.members.length > 0 && <h3 className="mt-3 mb-1 text-xs font-semibold text-[var(--color-text-subtle)]">Card members</h3>}
      {matches.filter((m) => on.has(m.userId)).map((m) => (
        <MenuItem key={m.userId} onClick={() => toggle.mutate({ id: card.id, userId: m.userId, on: false })}>
          <span className="flex items-center gap-2"><Avatar user={m.user} size={32} /><span className="flex-1">{m.user.name}</span><Icon name="close" size={14} /></span>
        </MenuItem>
      ))}
      <h3 className="mt-3 mb-1 text-xs font-semibold text-[var(--color-text-subtle)]">Board members</h3>
      {matches.filter((m) => !on.has(m.userId)).map((m) => (
        <MenuItem key={m.userId} onClick={() => toggle.mutate({ id: card.id, userId: m.userId, on: true })}>
          <span className="flex items-center gap-2"><Avatar user={m.user} size={32} />{m.user.name}</span>
        </MenuItem>
      ))}
    </div>
  );
}

function LabelsPane({ card, board }: { card: CardDetail; board: BoardData }) {
  const utils = api.useUtils();
  const inv = useCardInvalidate(card.id, board.id);
  const toggle = api.card.toggleLabel.useMutation({
    onMutate: ({ labelId, on }) => {
      const label = board.labels.find((l) => l.id === labelId)!;
      utils.card.get.setData({ id: card.id }, (c) =>
        c && { ...c, labels: on ? [...c.labels, { cardId: c.id, labelId, label }] : c.labels.filter((l) => l.labelId !== labelId) },
      );
      utils.board.get.setData({ id: board.id }, (b) =>
        b && {
          ...b,
          lists: b.lists.map((l) => ({
            ...l,
            cards: l.cards.map((c) => (c.id !== card.id ? c : { ...c, labels: on ? [...c.labels, { cardId: c.id, labelId, label }] : c.labels.filter((x) => x.labelId !== labelId) })),
          })),
        },
      );
    },
    onSettled: inv,
  });
  return <Labels board={board} selected={card.labels.map((l) => l.labelId)} onPick={(labelId, on) => toggle.mutate({ id: card.id, labelId, on })} />;
}

function ChecklistPane({ card, board }: { card: CardDetail; board: BoardData }) {
  const pop = usePopover();
  const [name, setName] = useState("Checklist");
  const [copyFrom, setCopyFrom] = useState("");
  const inv = useCardInvalidate(card.id, board.id);
  const add = api.card.addChecklist.useMutation({ onSettled: inv });
  const submit = () => {
    if (!name.trim()) return;
    add.mutate({ id: card.id, name: name.trim(), copyFrom: copyFrom || undefined });
    pop.close();
  };
  return (
    <div>
      <label className="mb-1 block text-xs font-bold text-[var(--color-text-subtle)]">Title</label>
      <input autoFocus onFocus={(e) => e.currentTarget.select()} className={inputCls} value={name} onChange={(e) => setName(e.target.value)} onKeyDown={(e) => e.key === "Enter" && submit()} />
      {card.checklists.length > 0 && (
        <>
          <label className="mt-3 mb-1 block text-xs font-bold text-[var(--color-text-subtle)]">Copy items from…</label>
          <select className={inputCls} value={copyFrom} onChange={(e) => setCopyFrom(e.target.value)}>
            <option value="">(none)</option>
            {card.checklists.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
          </select>
        </>
      )}
      <Button variant="primary" className="mt-3" onClick={submit}>Add</Button>
    </div>
  );
}

function MiniCalendar({ value, onPick }: { value: Date | null; onPick: (d: Date) => void }) {
  const [month, setMonth] = useState(startOfMonth(value ?? new Date()));
  const days = eachDayOfInterval({ start: startOfWeek(month), end: endOfWeek(endOfMonth(month)) });
  return (
    <div className="mb-3">
      <div className="mb-2 flex items-center justify-between">
        <IconButton onClick={() => setMonth(addMonths(month, -1))} aria-label="Previous month">‹</IconButton>
        <span className="text-sm font-medium">{format(month, "MMMM yyyy")}</span>
        <IconButton onClick={() => setMonth(addMonths(month, 1))} aria-label="Next month">›</IconButton>
      </div>
      <div className="grid grid-cols-7 text-center text-xs text-[var(--color-text-subtle)]">
        {["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].map((d) => <span key={d} className="py-1">{d}</span>)}
      </div>
      <div className="grid grid-cols-7 gap-0.5 text-center text-sm">
        {days.map((d) => {
          const sel = value && isSameDay(d, value);
          const today = isSameDay(d, new Date());
          return (
            <button
              key={d.toISOString()}
              onClick={() => onPick(d)}
              className={`h-9 rounded-[3px] transition-colors ${sel ? "bg-[var(--color-brand)] text-[var(--color-on-brand)]" : "hover:bg-[var(--color-neutral-hover)]"} ${!isSameMonth(d, month) ? "text-[var(--color-text-subtlest)]" : ""} ${today && !sel ? "font-bold text-[var(--color-brand)] underline" : ""}`}
            >
              {d.getDate()}
            </button>
          );
        })}
      </div>
    </div>
  );
}

function DatesPane({ card, board }: { card: CardDetail; board: BoardData }) {
  const pop = usePopover();
  const inv = useCardInvalidate(card.id, board.id);
  const update = api.card.update.useMutation({ onSettled: inv });
  const [startOn, setStartOn] = useState(!!card.start);
  const [dueOn, setDueOn] = useState(!!card.due || !card.start);
  const [start, setStart] = useState<Date>(card.start ?? new Date());
  const [due, setDue] = useState<Date>(card.due ?? (() => { const d = addDays(new Date(), 1); d.setHours(12, 0, 0, 0); return d; })());
  const [time, setTime] = useState(format(card.due ?? due, "HH:mm"));
  const [focus, setFocus] = useState<"start" | "due">(dueOn ? "due" : "start");
  const [repeat, setRepeat] = useState<Recurrence | "">((card.recurrence as Recurrence | null) ?? "");
  const withTime = (d: Date) => {
    const [h, m] = time.split(":").map(Number);
    const r = new Date(d);
    r.setHours(h ?? 12, m ?? 0, 0, 0);
    return r;
  };
  return (
    <div>
      <MiniCalendar
        value={focus === "due" ? (dueOn ? due : null) : startOn ? start : null}
        onPick={(d) => {
          if (focus === "due") { setDue(d); setDueOn(true); } else { setStart(d); setStartOn(true); }
        }}
      />
      <label className="mb-1 block text-xs font-bold text-[var(--color-text-subtle)]">Start date</label>
      <div className="flex items-center gap-2">
        <input type="checkbox" className="h-4 w-4 accent-[var(--color-brand)]" checked={startOn} onChange={(e) => setStartOn(e.target.checked)} />
        <input disabled={!startOn} onFocus={() => setFocus("start")} readOnly className={`${inputCls} w-28`} value={startOn ? format(start, "M/d/yyyy") : "M/D/YYYY"} />
      </div>
      <label className="mt-3 mb-1 block text-xs font-bold text-[var(--color-text-subtle)]">Due date</label>
      <div className="flex items-center gap-2">
        <input type="checkbox" className="h-4 w-4 accent-[var(--color-brand)]" checked={dueOn} onChange={(e) => setDueOn(e.target.checked)} />
        <input disabled={!dueOn} onFocus={() => setFocus("due")} readOnly className={`${inputCls} w-28`} value={dueOn ? format(due, "M/d/yyyy") : "M/D/YYYY"} />
        <input disabled={!dueOn} type="time" className={`${inputCls} w-28`} value={time} onChange={(e) => setTime(e.target.value)} />
      </div>
      <label className="mt-3 mb-1 block text-xs font-bold text-[var(--color-text-subtle)]">Repeat</label>
      <select disabled={!dueOn} className={inputCls} value={dueOn ? repeat : ""} onChange={(e) => setRepeat(e.target.value as Recurrence | "")}>
        <option value="">Never</option>
        {RECURRENCE_OPTIONS.map(([v, label]) => (
          <option key={v} value={v}>{label}</option>
        ))}
      </select>
      {dueOn && repeat && (
        <p className="mt-1 text-xs text-[var(--color-text-subtle)]">
          Completing this card moves it to the next due date and unchecks its checklists.
        </p>
      )}
      <Button
        variant="primary"
        className="mt-4 w-full"
        onClick={() => {
          update.mutate({
            id: card.id,
            start: startOn ? start : null,
            due: dueOn ? withTime(due) : null,
            // Repeating needs a due date to step from.
            recurrence: dueOn && repeat ? repeat : null,
          });
          pop.close();
        }}
      >
        Save
      </Button>
      <Button
        className="mt-2 w-full"
        onClick={() => {
          update.mutate({ id: card.id, start: null, due: null, dueComplete: false, recurrence: null });
          pop.close();
        }}
      >
        Remove
      </Button>
    </div>
  );
}

function AttachPane({ card, board }: { card: CardDetail; board: BoardData }) {
  const pop = usePopover();
  const [url, setUrl] = useState("");
  const [name, setName] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const file = useRef<HTMLInputElement>(null);
  const inv = useCardInvalidate(card.id, board.id);
  const addLink = api.card.addLink.useMutation({ onSettled: inv });
  return (
    <div>
      <h3 className="mb-1 text-xs font-bold text-[var(--color-text-subtle)]">Attach a file from your computer</h3>
      <p className="mb-2 text-xs text-[var(--color-text-subtle)]">You can also drag and drop files to upload them.</p>
      <input
        ref={file}
        type="file"
        multiple
        hidden
        onChange={async (e) => {
          const files = [...(e.target.files ?? [])];
          if (!files.length) return;
          setBusy(true);
          try {
            await uploadFiles(card.id, files);
            inv();
            pop.close();
          } catch (e) {
            setErr((e as Error).message);
          } finally {
            setBusy(false);
          }
        }}
      />
      <Button className="w-full" disabled={busy} onClick={() => file.current?.click()}>{busy ? "Uploading…" : "Choose a file"}</Button>
      {err && <p className="mt-1 text-xs text-[var(--color-danger)]">{err}</p>}
      <hr className="my-3 border-[var(--color-border)]" />
      <label className="mb-1 block text-xs font-bold text-[var(--color-text-subtle)]">Search or paste a link</label>
      <input className={inputCls} value={url} placeholder="https://…" onChange={(e) => setUrl(e.target.value)} />
      <label className="mt-2 mb-1 block text-xs font-bold text-[var(--color-text-subtle)]">Display text (optional)</label>
      <input className={inputCls} value={name} onChange={(e) => setName(e.target.value)} />
      <Button
        variant="primary"
        className="mt-3"
        disabled={!/^https?:\/\/\S+$/.test(url)}
        onClick={() => {
          addLink.mutate({ id: card.id, url, name: name || undefined });
          pop.close();
        }}
      >
        Insert
      </Button>
    </div>
  );
}

const COVER_COLORS = ["green", "yellow", "orange", "red", "purple", "blue", "sky", "lime", "pink", "black"];

function CoverPane({ card, board }: { card: CardDetail; board: BoardData }) {
  const utils = api.useUtils();
  const inv = useCardInvalidate(card.id, board.id);
  const update = api.card.update.useMutation({
    onMutate: (d) => utils.card.get.setData({ id: card.id }, (c) => c && { ...c, ...Object.fromEntries(Object.entries(d).filter(([, v]) => v !== undefined)) }),
    onSettled: inv,
  });
  const images = card.attachments.filter((a) => !!a.mimeType?.startsWith("image/") || /\.(png|jpe?g|gif|webp)$/i.test(a.url));
  const hasCover = !!(card.coverColor ?? card.coverAttachmentId);
  const preview = card.coverColor ? coverColor(card.coverColor) : "var(--color-neutral-bold)";
  return (
    <div>
      <h3 className="mb-1 text-xs font-bold text-[var(--color-text-subtle)]">Size</h3>
      <div className="grid grid-cols-2 gap-2">
        {(["normal", "full"] as const).map((size) => (
          <button
            key={size}
            disabled={!hasCover}
            onClick={() => update.mutate({ id: card.id, coverSize: size })}
            className={`h-16 overflow-hidden rounded-[3px] shadow-[var(--shadow-card)] disabled:opacity-50 ${card.coverSize === size && hasCover ? "ring-2 ring-[var(--color-focus)] ring-offset-1" : ""}`}
          >
            {size === "normal" ? (
              <>
                <div className="h-7" style={{ background: preview }} />
                <div className="space-y-1 p-1.5"><div className="h-1 w-3/4 rounded bg-[var(--color-neutral-bold)]" /><div className="h-1 w-1/2 rounded bg-[var(--color-neutral-bold)]" /></div>
              </>
            ) : (
              <div className="flex h-full flex-col justify-end space-y-1 p-1.5" style={{ background: preview }}>
                <div className="h-1 w-3/4 rounded bg-white/70" /><div className="h-1 w-1/2 rounded bg-white/70" />
              </div>
            )}
          </button>
        ))}
      </div>
      {hasCover && <Button className="mt-2 w-full" onClick={() => update.mutate({ id: card.id, coverColor: null, coverAttachmentId: null })}>Remove cover</Button>}
      <h3 className="mt-3 mb-1 text-xs font-bold text-[var(--color-text-subtle)]">Colors</h3>
      <div className="grid grid-cols-5 gap-2">
        {COVER_COLORS.map((c) => (
          <button
            key={c}
            onClick={() => update.mutate({ id: card.id, coverColor: c })}
            className={`h-8 rounded-[3px] ${card.coverColor === c ? "ring-2 ring-[var(--color-focus)] ring-offset-1" : ""}`}
            style={{ background: coverColor(c) }}
            aria-label={c}
          />
        ))}
      </div>
      {images.length > 0 && (
        <>
          <h3 className="mt-3 mb-1 text-xs font-bold text-[var(--color-text-subtle)]">Attachments</h3>
          <div className="grid grid-cols-3 gap-2">
            {images.map((a) => (
              <button
                key={a.id}
                onClick={() => update.mutate({ id: card.id, coverAttachmentId: a.id })}
                className={`h-12 rounded-[3px] bg-cover bg-center ${card.coverAttachmentId === a.id ? "ring-2 ring-[var(--color-focus)] ring-offset-1" : ""}`}
                style={{ backgroundImage: `url("${a.url}")` }}
              />
            ))}
          </div>
        </>
      )}
    </div>
  );
}

/** Board / list / position pickers shared by Move and Copy; returns the resolved target. */
function useDestination(board: BoardData, card: CardDetail, initialIndex: number) {
  const [value, setValue] = useState({ boardId: board.id, listId: card.list.id, index: initialIndex });
  const { data: workspaces } = api.workspace.list.useQuery();
  const { data: target } = api.board.get.useQuery({ id: value.boardId });
  const lists = target?.lists ?? [];
  const list = lists.find((l) => l.id === value.listId) ?? lists[0];
  const cards = list?.cards.filter((c) => c.id !== card.id) ?? [];
  const index = Math.min(value.index, cards.length);
  const ui = (
    <div className="space-y-2">
      <div>
        <label className="mb-1 block text-xs font-bold text-[var(--color-text-subtle)]">Board</label>
        <select className={inputCls} value={value.boardId} onChange={(e) => setValue({ boardId: e.target.value, listId: "", index: 0 })}>
          {workspaces?.flatMap((w) => w.boards).map((b) => <option key={b.id} value={b.id}>{b.name}{b.id === board.id ? " (current)" : ""}</option>)}
        </select>
      </div>
      <div className="grid grid-cols-[2fr_1fr] gap-2">
        <div>
          <label className="mb-1 block text-xs font-bold text-[var(--color-text-subtle)]">List</label>
          <select className={inputCls} value={list?.id ?? ""} onChange={(e) => setValue({ ...value, listId: e.target.value, index: 0 })}>
            {lists.map((l) => <option key={l.id} value={l.id}>{l.name}{l.id === card.list.id ? " (current)" : ""}</option>)}
          </select>
        </div>
        <div>
          <label className="mb-1 block text-xs font-bold text-[var(--color-text-subtle)]">Position</label>
          <select className={inputCls} value={index} onChange={(e) => setValue({ ...value, listId: list?.id ?? "", index: Number(e.target.value) })}>
            {Array.from({ length: cards.length + 1 }, (_, i) => <option key={i} value={i}>{i + 1}</option>)}
          </select>
        </div>
      </div>
    </div>
  );
  return { ui, boardId: value.boardId, listId: list?.id, afterId: index === 0 ? null : cards[index - 1]?.id ?? null };
}

function MovePane({ card, board }: { card: CardDetail; board: BoardData }) {
  const pop = usePopover();
  const router = useRouter();
  const inv = useCardInvalidate(card.id, board.id);
  const move = api.card.move.useMutation({ onSettled: inv });
  const idx = board.lists.find((l) => l.id === card.list.id)?.cards.findIndex((c) => c.id === card.id) ?? 0;
  const dest = useDestination(board, card, Math.max(0, idx));
  return (
    <div>
      {dest.ui}
      <Button
        variant="primary"
        className="mt-3"
        onClick={() => {
          if (!dest.listId) return;
          move.mutate({ id: card.id, listId: dest.listId, afterId: dest.afterId });
          pop.close();
          if (dest.boardId !== board.id) router.push(`/b/${dest.boardId}`);
        }}
      >
        Move
      </Button>
    </div>
  );
}

function CopyPane({ card, board }: { card: CardDetail; board: BoardData }) {
  const pop = usePopover();
  const inv = useCardInvalidate(card.id, board.id);
  const copy = api.card.copy.useMutation({ onSettled: inv });
  const [title, setTitle] = useState(card.title);
  const [keep, setKeep] = useState({ checklists: true, labels: true, members: true, attachments: true });
  const dest = useDestination(board, card, 0);
  const counts = {
    checklists: card.checklists.length,
    labels: card.labels.length,
    members: card.members.length,
    attachments: card.attachments.length,
  };
  return (
    <div>
      <label className="mb-1 block text-xs font-bold text-[var(--color-text-subtle)]">Title</label>
      <textarea className={inputCls} value={title} onChange={(e) => setTitle(e.target.value)} rows={2} />
      <label className="mt-2 mb-1 block text-xs font-bold text-[var(--color-text-subtle)]">Keep…</label>
      {(Object.keys(keep) as (keyof typeof keep)[]).filter((k) => counts[k] > 0).map((k) => (
        <label key={k} className="flex items-center gap-2 py-0.5 text-sm capitalize">
          <input type="checkbox" className="h-4 w-4 accent-[var(--color-brand)]" checked={keep[k]} onChange={(e) => setKeep({ ...keep, [k]: e.target.checked })} />
          {k} ({counts[k]})
        </label>
      ))}
      <h3 className="mt-3 mb-1 text-xs font-bold text-[var(--color-text-subtle)]">Copy to…</h3>
      {dest.ui}
      <Button
        variant="primary"
        className="mt-3"
        onClick={() => {
          if (!dest.listId || !title.trim()) return;
          copy.mutate({ id: card.id, title: title.trim(), listId: dest.listId, afterId: dest.afterId, keep });
          pop.close();
        }}
      >
        Create card
      </Button>
    </div>
  );
}

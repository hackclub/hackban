"use client";

import { AnimatePresence, motion } from "framer-motion";
import { useRouter } from "next/navigation";
import { useState } from "react";

import { api } from "~/trpc/react";

import { AutoTextarea, BOARD_COLORS, BOARD_GRADIENTS, Button, Icon, IconButton, LABEL_COLORS, Markdown, inputCls, labelStyle } from "../ui";
import { ActivityItem } from "./activity";
import { type BoardData } from "./types";

type Pane = "main" | "about" | "activity" | "archived" | "background" | "labels" | "move" | "close";
const TITLES: Record<Pane, string> = {
  main: "Menu",
  about: "About this board",
  activity: "Activity",
  archived: "Archived items",
  background: "Change background",
  labels: "Labels",
  move: "Move board",
  close: "Close board?",
};

export function BoardMenu({ board, open, onClose, onOpenCard }: { board: BoardData; open: boolean; onClose: () => void; onOpenCard: (id: string) => void }) {
  const [pane, setPane] = useState<Pane>("main");
  return (
    <AnimatePresence onExitComplete={() => setPane("main")}>
      {open && (
        <motion.aside
          initial={{ x: 340 }}
          animate={{ x: 0 }}
          exit={{ x: 340 }}
          transition={{ type: "tween", duration: 0.2, ease: "easeOut" }}
          className="absolute top-0 right-0 bottom-0 z-30 flex w-[339px] flex-col bg-[var(--color-surface)] shadow-[var(--shadow-overlay)]"
        >
          <div className="grid h-12 shrink-0 grid-cols-[32px_1fr_32px] items-center border-b border-[var(--color-border)] px-3">
            {pane !== "main" ? (
              <IconButton onClick={() => setPane("main")} aria-label="Back"><Icon name="back" /></IconButton>
            ) : <span />}
            <h2 className="text-center font-semibold">{TITLES[pane]}</h2>
            <IconButton onClick={onClose} aria-label="Close"><Icon name="close" /></IconButton>
          </div>
          <div className="min-h-0 flex-1 overflow-y-auto p-3">
            {pane === "main" && <Main board={board} setPane={setPane} onOpenCard={onOpenCard} />}
            {pane === "about" && <About board={board} />}
            {pane === "activity" && <Activity board={board} onOpenCard={onOpenCard} />}
            {pane === "archived" && <Archived board={board} onOpenCard={onOpenCard} />}
            {pane === "background" && <Background board={board} />}
            {pane === "labels" && <Labels board={board} />}
            {pane === "move" && <MoveBoard board={board} onDone={() => setPane("main")} />}
            {pane === "close" && <CloseBoard board={board} />}
          </div>
        </motion.aside>
      )}
    </AnimatePresence>
  );
}

function Row({ icon, children, onClick, style }: { icon?: string; children: React.ReactNode; onClick: () => void; style?: React.CSSProperties }) {
  return (
    <button onClick={onClick} className="flex h-10 w-full items-center gap-3 rounded-lg px-3 text-left text-sm hover:bg-[var(--color-neutral)]">
      {style ? <span className="h-5 w-5 rounded-[3px]" style={style} /> : <Icon name={icon!} className="text-[var(--color-text-subtle)]" />}
      {children}
    </button>
  );
}

function Main({ board, setPane, onOpenCard }: { board: BoardData; setPane: (p: Pane) => void; onOpenCard: (id: string) => void }) {
  return (
    <>
      <Row icon="desc" onClick={() => setPane("about")}>About this board</Row>
      <Row icon="activity" onClick={() => setPane("activity")}>Activity</Row>
      <Row icon="archive" onClick={() => setPane("archived")}>Archived items</Row>
      <hr className="my-2 border-[var(--color-border)]" />
      <Row onClick={() => setPane("background")} style={board.bgImage ? { backgroundImage: `url(${board.bgImage})`, backgroundSize: "cover" } : { background: board.background }}>Change background</Row>
      <Row icon="label" onClick={() => setPane("labels")}>Labels</Row>
      <hr className="my-2 border-[var(--color-border)]" />
      {board.myRole === "admin" && <Row icon="move" onClick={() => setPane("move")}>Move board…</Row>}
      {board.myRole !== "observer" && <Row icon="close" onClick={() => setPane("close")}>Close board</Row>}
      <hr className="my-2 border-[var(--color-border)]" />
      <h3 className="mt-2 mb-1 flex items-center gap-2 px-3 font-semibold"><Icon name="activity" /> Activity</h3>
      <Activity board={board} onOpenCard={onOpenCard} />
    </>
  );
}

function About({ board }: { board: BoardData }) {
  const admins = board.members.filter((m) => m.role === "admin");
  const [editing, setEditing] = useState(false);
  const [desc, setDesc] = useState(board.description ?? "");
  const utils = api.useUtils();
  const update = api.board.update.useMutation({ onSettled: () => utils.board.get.invalidate({ id: board.id }) });
  return (
    <div>
      <h3 className="mb-2 font-semibold">Board admins</h3>
      {admins.map((m) => <div key={m.userId} className="mb-1 text-sm">{m.user.name}</div>)}
      <h3 className="mt-4 mb-2 font-semibold">Description</h3>
      {editing ? (
        <>
          <AutoTextarea autoFocus minRows={4} className={inputCls} value={desc} onChange={(e) => setDesc(e.target.value)} />
          <div className="mt-2 flex gap-1">
            <Button variant="primary" onClick={() => { update.mutate({ id: board.id, description: desc }); setEditing(false); }}>Save</Button>
            <Button variant="subtle" onClick={() => setEditing(false)}>Cancel</Button>
          </div>
        </>
      ) : (
        <div onClick={() => setEditing(true)} className="min-h-16 cursor-pointer rounded-[3px] bg-[var(--color-neutral)] p-3 text-sm hover:bg-[var(--color-neutral-hover)]">
          {board.description ? <Markdown text={board.description} /> : "Add a description to let your teammates know what this board is used for."}
        </div>
      )}
    </div>
  );
}

function Activity({ board, onOpenCard }: { board: BoardData; onOpenCard: (id: string) => void }) {
  const q = api.board.activity.useInfiniteQuery({ id: board.id }, { getNextPageParam: (p) => p.next });
  return (
    <div>
      {q.data?.pages.flatMap((p) => p.items).map((a) => <ActivityItem key={a.id} a={a} onOpenCard={onOpenCard} />)}
      {q.hasNextPage && <Button className="mt-2 w-full" onClick={() => void q.fetchNextPage()}>Load more activity</Button>}
    </div>
  );
}

function Archived({ board, onOpenCard }: { board: BoardData; onOpenCard: (id: string) => void }) {
  const [tab, setTab] = useState<"cards" | "lists">("cards");
  const [q, setQ] = useState("");
  const utils = api.useUtils();
  const { data } = api.board.archived.useQuery({ id: board.id });
  const inv = () => {
    void utils.board.archived.invalidate({ id: board.id });
    void utils.board.get.invalidate({ id: board.id });
  };
  const restoreCard = api.card.update.useMutation({ onSettled: inv });
  const delCard = api.card.delete.useMutation({ onSettled: inv });
  const restoreList = api.list.update.useMutation({ onSettled: inv });
  const [confirm, setConfirm] = useState<string | null>(null);
  return (
    <div>
      <div className="mb-3 flex gap-2">
        <input className={inputCls} placeholder="Search archive…" value={q} onChange={(e) => setQ(e.target.value)} />
        <Button onClick={() => setTab(tab === "cards" ? "lists" : "cards")}>Switch to {tab === "cards" ? "lists" : "cards"}</Button>
      </div>
      {tab === "cards" &&
        data?.cards.filter((c) => c.title.toLowerCase().includes(q.toLowerCase())).map((c) => (
          <div key={c.id} className="mb-3">
            <div onClick={() => onOpenCard(c.id)} className="cursor-pointer rounded-lg bg-[var(--color-surface)] p-2 text-sm shadow-[var(--shadow-card)] hover:bg-[var(--color-surface-hover)]">
              {c.title}
              <div className="mt-1 flex items-center gap-1 text-xs text-[var(--color-text-subtle)]"><Icon name="archive" size={12} /> Archived · {c.list.name}</div>
            </div>
            <div className="mt-1 flex gap-2 text-xs">
              <button className="text-[var(--color-text-subtle)] underline" onClick={() => restoreCard.mutate({ id: c.id, closed: false })}>Restore</button>
              {confirm === c.id ? (
                <button className="font-semibold text-[var(--color-danger)] underline" onClick={() => delCard.mutate({ id: c.id })}>Really delete? This can&apos;t be undone.</button>
              ) : (
                <button className="text-[var(--color-danger)] underline" onClick={() => setConfirm(c.id)}>Delete</button>
              )}
            </div>
          </div>
        ))}
      {tab === "lists" &&
        data?.lists.filter((l) => l.name.toLowerCase().includes(q.toLowerCase())).map((l) => (
          <div key={l.id} className="flex items-center justify-between border-b border-[var(--color-border)] py-2 text-sm">
            {l.name}
            <Button onClick={() => restoreList.mutate({ id: l.id, closed: false })}>Restore</Button>
          </div>
        ))}
      {data && (tab === "cards" ? data.cards : data.lists).length === 0 && (
        <p className="py-6 text-center text-sm text-[var(--color-text-subtlest)]">No archived {tab}</p>
      )}
    </div>
  );
}

function Background({ board }: { board: BoardData }) {
  const utils = api.useUtils();
  const [url, setUrl] = useState("");
  const update = api.board.update.useMutation({
    onMutate: (d) => utils.board.get.setData({ id: board.id }, (b) => b && { ...b, background: d.background ?? b.background, bgImage: d.bgImage === undefined ? b.bgImage : d.bgImage }),
    onSettled: () => utils.board.get.invalidate({ id: board.id }),
  });
  const [uploading, setUploading] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const upload = async (file: File) => {
    setUploading(true);
    setErr(null);
    const body = new FormData();
    body.append("file", file);
    const res = await fetch(`/api/boards/${board.id}/background`, { method: "POST", body }).catch(() => null);
    if (!res?.ok) setErr(res ? await res.text() : "Upload failed. Check your connection.");
    await utils.board.get.invalidate({ id: board.id });
    setUploading(false);
  };
  return (
    <div>
      <label className={`mb-4 flex h-16 cursor-pointer items-center justify-center gap-2 rounded-lg border-2 border-dashed border-[var(--color-border)] text-sm font-medium text-[var(--color-text-subtle)] hover:bg-[var(--color-neutral)] ${uploading ? "pointer-events-none opacity-50" : ""}`}>
        <Icon name="plus" /> {uploading ? "Uploading…" : "Upload an image"}
        <input
          type="file"
          accept="image/png,image/jpeg,image/gif,image/webp"
          hidden
          disabled={uploading}
          onChange={(e) => {
            const f = e.target.files?.[0];
            e.target.value = "";
            if (f) void upload(f);
          }}
        />
      </label>
      {err && <p className="-mt-2 mb-3 text-xs text-[var(--color-danger)]">{err}</p>}
      <h3 className="mb-2 text-sm font-semibold">Gradients</h3>
      <div className="grid grid-cols-3 gap-2">
        {BOARD_GRADIENTS.map((g) => (
          <button key={g} className="h-16 rounded-lg hover:brightness-90" style={{ background: g }} onClick={() => update.mutate({ id: board.id, background: g, bgImage: null })} />
        ))}
      </div>
      <h3 className="mt-4 mb-2 text-sm font-semibold">Colors</h3>
      <div className="grid grid-cols-3 gap-2">
        {BOARD_COLORS.map((c) => (
          <button key={c} className="h-16 rounded-lg hover:brightness-90" style={{ background: c }} onClick={() => update.mutate({ id: board.id, background: c, bgImage: null })} />
        ))}
      </div>
      <h3 className="mt-4 mb-2 text-sm font-semibold">Image URL</h3>
      <input className={inputCls} placeholder="https://images.unsplash.com/…" value={url} onChange={(e) => setUrl(e.target.value)} />
      <Button className="mt-2" disabled={!url.startsWith("https://")} onClick={() => update.mutate({ id: board.id, bgImage: url })}>Use image</Button>
    </div>
  );
}

export function Labels({ board, onPick, selected }: { board: BoardData; onPick?: (labelId: string, on: boolean) => void; selected?: string[] }) {
  const [q, setQ] = useState("");
  const [editing, setEditing] = useState<{ id?: string; name: string; color: string | null } | null>(null);
  const utils = api.useUtils();
  const inv = () => utils.board.get.invalidate({ id: board.id });
  const create = api.card.createLabel.useMutation({ onSettled: inv });
  const update = api.card.updateLabel.useMutation({ onSettled: inv });
  const del = api.card.deleteLabel.useMutation({ onSettled: inv });

  if (editing) {
    return (
      <div>
        <div className="-mx-3 mb-3 flex h-20 items-center justify-center bg-[var(--color-list)]">
          <span className="h-8 max-w-[220px] min-w-[120px] truncate rounded-[3px] px-3 text-sm leading-8 font-medium" style={labelStyle(editing.color)}>{editing.name}</span>
        </div>
        <label className="mb-1 block text-xs font-bold text-[var(--color-text-subtle)]">Title</label>
        <input autoFocus className={inputCls} value={editing.name} onChange={(e) => setEditing({ ...editing, name: e.target.value })} />
        <label className="mt-3 mb-1 block text-xs font-bold text-[var(--color-text-subtle)]">Select a color</label>
        <div className="grid grid-cols-5 gap-1">
          {LABEL_COLORS.map((c) => (
            <button key={c} className={`h-8 rounded-[3px] ${editing.color === c ? "ring-2 ring-[var(--color-focus)] ring-offset-1" : ""}`} style={labelStyle(c)} onClick={() => setEditing({ ...editing, color: c })} aria-label={c} />
          ))}
        </div>
        <Button className="mt-2 w-full" disabled={!editing.color} onClick={() => setEditing({ ...editing, color: null })}>✕ Remove color</Button>
        <hr className="my-3 border-[var(--color-border)]" />
        <div className="flex justify-between">
          <Button
            variant="primary"
            onClick={() => {
              if (editing.id) update.mutate({ id: editing.id, name: editing.name, color: editing.color });
              else create.mutate({ boardId: board.id, name: editing.name, color: editing.color });
              setEditing(null);
            }}
          >
            {editing.id ? "Save" : "Create"}
          </Button>
          {editing.id && <Button variant="danger" onClick={() => { del.mutate({ id: editing.id! }); setEditing(null); }}>Delete</Button>}
        </div>
      </div>
    );
  }
  return (
    <div>
      <input className={inputCls} placeholder="Search labels…" value={q} onChange={(e) => setQ(e.target.value)} />
      <h3 className="mt-3 mb-1 text-xs font-semibold text-[var(--color-text-subtle)]">Labels</h3>
      {board.labels.filter((l) => l.name.toLowerCase().includes(q.toLowerCase()) || (l.color ?? "").includes(q.toLowerCase())).map((l) => (
        <div key={l.id} className="flex items-center gap-1 py-0.5">
          {onPick && (
            <input type="checkbox" className="mr-1 h-4 w-4 accent-[var(--color-brand)]" checked={selected?.includes(l.id) ?? false} onChange={(e) => onPick(l.id, e.target.checked)} />
          )}
          <button
            onClick={() => (onPick ? onPick(l.id, !selected?.includes(l.id)) : setEditing({ id: l.id, name: l.name, color: l.color }))}
            className="h-8 min-w-0 flex-1 truncate rounded-[3px] px-3 text-left text-sm font-medium transition hover:brightness-95"
            style={labelStyle(l.color)}
          >
            {l.name}
          </button>
          <IconButton onClick={() => setEditing({ id: l.id, name: l.name, color: l.color })} aria-label="Edit label"><Icon name="edit" size={14} /></IconButton>
        </div>
      ))}
      <Button className="mt-2 w-full" onClick={() => setEditing({ name: q, color: "green" })}>Create a new label</Button>
    </div>
  );
}

function MoveBoard({ board, onDone }: { board: BoardData; onDone: () => void }) {
  const utils = api.useUtils();
  const { data: workspaces } = api.workspace.list.useQuery();
  const [target, setTarget] = useState("");
  const move = api.board.move.useMutation({
    onSuccess: () => {
      void utils.board.get.invalidate({ id: board.id });
      void utils.workspace.list.invalidate();
      void utils.workspace.get.invalidate();
      onDone();
    },
  });
  const options = workspaces?.filter((w) => w.id !== board.workspace.id) ?? [];
  const to = (target !== "" ? target : options[0]?.id) ?? "";
  const toName = options.find((w) => w.id === to)?.name;
  return (
    <div className="text-sm">
      <p className="mb-3 text-[var(--color-text-subtle)]">
        Currently in <b className="text-[var(--color-text)]">{board.workspace.name}</b>.
      </p>
      {options.length === 0 ? (
        <p className="text-[var(--color-text-subtle)]">You&apos;re not in any other workspace to move it to.</p>
      ) : (
        <>
          <label className="mb-1 block text-xs font-bold text-[var(--color-text-subtle)]">Move to</label>
          <select className={inputCls} value={to} onChange={(e) => setTarget(e.target.value)}>
            {options.map((w) => (
              <option key={w.id} value={w.id}>{w.name}</option>
            ))}
          </select>
          <ul className="mt-3 list-disc space-y-1 pl-5 text-xs text-[var(--color-text-subtle)]">
            <li>Board members keep their access.</li>
            {board.visibility === "workspace" && (
              <li>
                It&apos;s workspace-visible, so members of <b>{toName}</b> will be able to see it, and members of {board.workspace.name} who aren&apos;t on the board will lose access.
              </li>
            )}
            {board.visibility === "private" && <li>It stays private to its members.</li>}
            {board.visibility === "public" && <li>It stays public.</li>}
          </ul>
          <Button variant="primary" className="mt-4 w-full" disabled={!to || move.isPending} onClick={() => move.mutate({ id: board.id, workspaceId: to })}>
            {move.isPending ? "Moving…" : `Move to ${toName ?? "workspace"}`}
          </Button>
          {move.error && <p className="mt-2 text-xs text-[var(--color-danger)]">{move.error.message}</p>}
        </>
      )}
    </div>
  );
}

function CloseBoard({ board }: { board: BoardData }) {
  const router = useRouter();
  const utils = api.useUtils();
  const update = api.board.update.useMutation({
    onSuccess: () => {
      void utils.workspace.list.invalidate();
      router.push("/");
    },
  });
  return (
    <div>
      <p className="mb-3 text-sm">You can find and reopen closed boards from your account menu → Closed boards.</p>
      <Button variant="danger" className="w-full" onClick={() => update.mutate({ id: board.id, closed: true })}>Close</Button>
    </div>
  );
}

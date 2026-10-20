"use client";

import { motion } from "framer-motion";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";

import { api } from "~/trpc/react";

import { CreateBoardPopover } from "./create-board";
import {
  BOARD_COLORS,
  BOARD_GRADIENTS,
  Button,
  Icon,
  MenuItem,
  MenuSep,
  Popover,
  WorkspaceLogo,
  boardBg,
  inputCls,
  usePopoverState,
} from "./ui";

export type Tile = { id: string; name: string; background: string; bgImage: string | null; starred?: boolean };

type Pane = "main" | "rename" | "background" | "move" | "copy";
const PANE_TITLES: Record<Exclude<Pane, "main">, string> = {
  rename: "Rename board",
  background: "Change background",
  move: "Move to workspace",
  copy: "Copy board",
};

export function BoardTile({ b, children }: { b: Tile; children?: React.ReactNode }) {
  const utils = api.useUtils();
  const router = useRouter();
  const refresh = () =>
    Promise.all([
      utils.workspace.list.invalidate(),
      utils.board.recent.invalidate(),
      utils.board.guestBoards.invalidate(),
      utils.workspace.get.invalidate(),
      utils.board.get.invalidate({ id: b.id }),
    ]);
  const star = api.board.star.useMutation({
    onMutate: async ({ id, starred }) => {
      await Promise.all([utils.workspace.list.cancel(), utils.board.recent.cancel(), utils.workspace.get.cancel()]);
      const flip = <T extends { id: string }>(x: T) => (x.id === id ? { ...x, starred } : x);
      utils.workspace.list.setData(undefined, (ws) => ws?.map((w) => ({ ...w, boards: w.boards.map(flip) })));
      utils.board.recent.setData(undefined, (r) => r?.map(flip));
    },
    onSettled: refresh,
  });
  const update = api.board.update.useMutation({ onSettled: refresh });
  const move = api.board.move.useMutation({ onSettled: refresh });
  const copy = api.board.copy.useMutation({
    onSuccess: (nb) => {
      void refresh();
      router.push(`/b/${nb.id}`);
    },
  });
  const menu = usePopoverState();
  const [pane, setPane] = useState<Pane>("main");
  const [name, setName] = useState(b.name);
  const [copyName, setCopyName] = useState(`${b.name} (copy)`);
  const [keepCards, setKeepCards] = useState(true);
  const { data: workspaces } = api.workspace.list.useQuery(undefined, { enabled: menu.open });
  const currentWs = workspaces?.find((w) => w.boards.some((x) => x.id === b.id))?.id;
  const [targetWs, setTargetWs] = useState<string | null>(null);
  const wsChoice = targetWs ?? currentWs ?? workspaces?.[0]?.id ?? "";
  const [copied, setCopied] = useState(false);
  const err = move.error ?? copy.error ?? update.error;
  const close = () => {
    menu.close();
    setPane("main");
    setName(b.name);
    setTargetWs(null);
    move.reset();
    copy.reset();
  };

  return (
    <div className="group relative">
      <Link href={`/b/${b.id}`} className="relative block h-24 overflow-hidden rounded-[3px] p-2 pr-9 text-white" style={boardBg(b)}>
        <span className="absolute inset-0 bg-black/15 transition-colors group-hover:bg-black/30" />
        <span className="relative block text-base font-bold break-words [text-shadow:0_0_4px_#0006]">{b.name}</span>
        {children}
        {b.starred !== undefined && (
          <button
            onClick={(e) => {
              e.preventDefault();
              star.mutate({ id: b.id, starred: !b.starred });
            }}
            className={`absolute right-2 bottom-2 transition-all duration-100 ${b.starred ? "text-[#f5cd47] opacity-100" : "translate-x-4 opacity-0 group-hover:translate-x-0 group-hover:opacity-100 hover:scale-125"}`}
            aria-label={b.starred ? "Unstar board" : "Star board"}
            aria-pressed={b.starred}
            title={b.starred ? "Click to unstar" : "Click to star"}
          >
            <Icon name={b.starred ? "star" : "starOutline"} className="drop-shadow-[0_1px_1px_#0008]" />
          </button>
        )}
      </Link>
      <button
        onClick={menu.toggle}
        className={`absolute top-1.5 right-1.5 flex h-7 w-7 items-center justify-center rounded-[3px] text-white transition-opacity hover:bg-white/25 focus-visible:opacity-100 ${menu.open ? "bg-white/25 opacity-100" : "opacity-0 group-hover:opacity-100"}`}
        aria-label="Board actions"
      >
        <Icon name="more" size={16} />
      </button>
      <Popover
        anchor={menu.anchor}
        open={menu.open}
        onClose={close}
        title={pane === "main" ? b.name : PANE_TITLES[pane]}
        onBack={pane === "main" ? undefined : () => setPane("main")}
        width={280}
      >
        {pane === "main" && (
          <>
            <MenuItem onClick={() => window.open(`/b/${b.id}`, "_blank")}>Open in new tab</MenuItem>
            <MenuItem
              onClick={() => {
                void navigator.clipboard.writeText(`${window.location.origin}/b/${b.id}`);
                setCopied(true);
                setTimeout(() => setCopied(false), 1200);
              }}
            >
              {copied ? "Link copied!" : "Copy link"}
            </MenuItem>
            {b.starred !== undefined && (
              <MenuItem onClick={() => (star.mutate({ id: b.id, starred: !b.starred }), close())}>{b.starred ? "Unstar" : "Star"}</MenuItem>
            )}
            <MenuSep />
            <MenuItem onClick={() => setPane("rename")}>Rename…</MenuItem>
            <MenuItem onClick={() => setPane("background")}>Change background…</MenuItem>
            <MenuItem onClick={() => setPane("move")}>Move to workspace…</MenuItem>
            <MenuItem onClick={() => setPane("copy")}>Copy board…</MenuItem>
            <MenuSep />
            <MenuItem danger onClick={() => (update.mutate({ id: b.id, closed: true }), close())}>Close board</MenuItem>
          </>
        )}
        {pane === "rename" && (
          <form
            onSubmit={(e) => {
              e.preventDefault();
              if (name.trim() && name.trim() !== b.name) update.mutate({ id: b.id, name: name.trim() });
              close();
            }}
            className="pb-1"
          >
            <input autoFocus className={inputCls} value={name} onChange={(e) => setName(e.target.value)} onFocus={(e) => e.target.select()} />
            <Button variant="primary" className="mt-2" type="submit">Save</Button>
          </form>
        )}
        {pane === "background" && (
          <div className="grid grid-cols-3 gap-2 pb-1">
            {[...BOARD_GRADIENTS, ...BOARD_COLORS].map((bg) => (
              <button
                key={bg}
                onClick={() => update.mutate({ id: b.id, background: bg, bgImage: null })}
                className={`h-12 rounded-[3px] transition hover:brightness-90 ${b.background === bg && !b.bgImage ? "ring-2 ring-[var(--color-focus)] ring-offset-1" : ""}`}
                style={{ background: bg }}
                aria-label="Background"
              />
            ))}
          </div>
        )}
        {pane === "move" && (
          <div className="pb-1">
            <label className="mb-1 block text-xs font-bold text-[var(--color-text-subtle)]">Workspace</label>
            <select className={inputCls} value={wsChoice} onChange={(e) => setTargetWs(e.target.value)}>
              {workspaces?.map((w) => (
                <option key={w.id} value={w.id}>
                  {w.name}
                  {w.id === currentWs ? " (current)" : ""}
                </option>
              ))}
            </select>
            <Button
              variant="primary"
              className="mt-3"
              disabled={!wsChoice || wsChoice === currentWs || move.isPending}
              onClick={() => move.mutate({ id: b.id, workspaceId: wsChoice }, { onSuccess: close })}
            >
              Move
            </Button>
          </div>
        )}
        {pane === "copy" && (
          <div className="pb-1">
            <label className="mb-1 block text-xs font-bold text-[var(--color-text-subtle)]">Title</label>
            <input autoFocus className={inputCls} value={copyName} onChange={(e) => setCopyName(e.target.value)} />
            <label className="mt-3 mb-1 block text-xs font-bold text-[var(--color-text-subtle)]">Workspace</label>
            <select className={inputCls} value={wsChoice} onChange={(e) => setTargetWs(e.target.value)}>
              {workspaces?.map((w) => <option key={w.id} value={w.id}>{w.name}</option>)}
            </select>
            <label className="mt-3 flex items-center gap-2 text-sm">
              <input type="checkbox" className="h-4 w-4 accent-[var(--color-brand)]" checked={keepCards} onChange={(e) => setKeepCards(e.target.checked)} />
              Keep cards
            </label>
            <p className="mt-1 text-xs text-[var(--color-text-subtle)]">Lists and labels are always copied. Members, comments and attachments are not.</p>
            <Button
              variant="primary"
              className="mt-3"
              disabled={!copyName.trim() || !wsChoice || copy.isPending}
              onClick={() => copy.mutate({ id: b.id, name: copyName.trim(), workspaceId: wsChoice, keepCards })}
            >
              {copy.isPending ? "Copying…" : "Create"}
            </Button>
          </div>
        )}
        {err && <p className="pb-2 text-xs text-[var(--color-danger)]">{err.message}</p>}
      </Popover>
    </div>
  );
}

export function Home() {
  const { data: workspaces } = api.workspace.list.useQuery();
  const { data: recent } = api.board.recent.useQuery();
  const { data: guestBoards } = api.board.guestBoards.useQuery();
  // Guest boards grouped by the workspace they live in.
  const guestGroups = new Map<string, { name: string; boards: NonNullable<typeof guestBoards> }>();
  for (const b of guestBoards ?? []) {
    const g = guestGroups.get(b.workspace.id) ?? { name: b.workspace.name, boards: [] };
    g.boards.push(b);
    guestGroups.set(b.workspace.id, g);
  }
  const [createFor, setCreateFor] = useState<{ el: HTMLElement; ws: string } | null>(null);
  const [newWs, setNewWs] = useState<string | null>(null);
  const utils = api.useUtils();
  const createWs = api.workspace.create.useMutation({
    onSuccess: () => {
      setNewWs(null);
      void utils.workspace.list.invalidate();
    },
  });
  const starred = workspaces?.flatMap((w) => w.boards.filter((b) => b.starred)) ?? [];

  return (
    <div className="mx-auto flex w-full max-w-[1200px] gap-8 px-4 pt-10 pb-16">
      <nav className="sticky top-10 hidden w-64 shrink-0 self-start md:block">
        <a className="flex h-8 items-center gap-2 rounded-[3px] bg-[var(--color-brand-subtle)] px-2 font-medium text-[var(--color-brand)]">
          <Icon name="grid" /> Boards
        </a>
        <Link href="/import" className="mt-1 flex h-8 items-center gap-2 rounded-[3px] px-2 font-medium hover:bg-[var(--color-neutral)]">
          <Icon name="download" /> Import from Trello
        </Link>
        <div className="mt-4 mb-1 flex items-center justify-between px-2 text-xs font-semibold text-[var(--color-text-subtle)]">
          Workspaces
          <button onClick={() => setNewWs("")} className="rounded p-1 hover:bg-[var(--color-neutral)]" aria-label="Create workspace">
            <Icon name="plus" size={14} />
          </button>
        </div>
        {newWs !== null && (
          <input
            autoFocus
            className={`${inputCls} mb-1`}
            placeholder="Workspace name"
            value={newWs}
            onChange={(e) => setNewWs(e.target.value)}
            onBlur={() => !newWs && setNewWs(null)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && newWs.trim()) createWs.mutate({ name: newWs.trim() });
              if (e.key === "Escape") setNewWs(null);
            }}
          />
        )}
        {workspaces?.map((w) => (
          <Link key={w.id} href={`/w/${w.id}`} className="flex h-9 items-center gap-2 rounded-[3px] px-2 hover:bg-[var(--color-neutral)]">
            <WorkspaceLogo ws={w} size={24} />
            <span className="truncate text-sm font-medium">{w.name}</span>
          </Link>
        ))}
      </nav>

      <main className="min-w-0 flex-1">
        {starred.length > 0 && (
          <Section icon="star" title="Starred boards">
            {starred.map((b) => <BoardTile key={b.id} b={b} />)}
          </Section>
        )}
        {!!recent?.length && (
          <Section icon="clock" title="Recently viewed">
            {recent.map((b) => <BoardTile key={b.id} b={b} />)}
          </Section>
        )}
        <h2 className="mt-2 mb-4 text-base font-bold text-[var(--color-text-subtle)] uppercase">Your workspaces</h2>
        {workspaces?.map((w) => (
          <section key={w.id} id={`ws-${w.id}`} className="mb-10">
            <div className="mb-3 flex items-center gap-3">
              <WorkspaceLogo ws={w} size={32} />
              <h3 className="flex-1 text-base font-bold">{w.name}</h3>
              <Link href={`/w/${w.id}/members`} className="flex h-8 items-center gap-1.5 rounded-[3px] bg-[var(--color-neutral)] px-3 text-sm font-medium hover:bg-[var(--color-neutral-hover)]">
                <Icon name="people" size={14} /> Members
              </Link>
              <Link href={`/w/${w.id}/settings`} className="flex h-8 items-center gap-1.5 rounded-[3px] bg-[var(--color-neutral)] px-3 text-sm font-medium hover:bg-[var(--color-neutral-hover)]">
                Settings
              </Link>
            </div>
            <motion.div layout className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-4">
              {w.boards.map((b) => <BoardTile key={b.id} b={b} />)}
              <button
                onClick={(e) => setCreateFor({ el: e.currentTarget, ws: w.id })}
                className="h-24 rounded-[3px] bg-[var(--color-neutral)] text-sm text-[var(--color-text-subtle)] transition-colors hover:bg-[var(--color-neutral-hover)]"
              >
                Create new board
              </button>
            </motion.div>
          </section>
        ))}
        {!workspaces && <div className="h-40 animate-pulse rounded bg-[var(--color-neutral)]" />}
        {guestGroups.size > 0 && (
          <>
            <h2 className="mt-2 mb-1 text-base font-bold text-[var(--color-text-subtle)] uppercase">Guest boards</h2>
            <p className="mb-4 text-sm text-[var(--color-text-subtlest)]">Boards you&apos;ve been added to without being in their workspace.</p>
            {[...guestGroups].map(([id, g]) => (
              <section key={id} className="mb-10">
                <h3 className="mb-3 flex items-center gap-3 text-base font-bold">
                  <WorkspaceLogo ws={{ name: g.name }} size={32} />
                  {g.name}
                </h3>
                <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-4">
                  {g.boards.map((b) => (
                    <BoardTile key={b.id} b={b} />
                  ))}
                </div>
              </section>
            ))}
          </>
        )}
      </main>
      <CreateBoardPopover
        key={createFor?.ws}
        anchor={createFor ? { el: createFor.el } : null}
        workspaceId={createFor?.ws}
        onClose={() => setCreateFor(null)}
      />
    </div>
  );
}

function Section({ icon, title, children }: { icon: string; title: string; children: React.ReactNode }) {
  return (
    <section className="mb-10">
      <h2 className="mb-3 flex items-center gap-2 text-base font-bold">
        <Icon name={icon} size={20} className="text-[var(--color-text-subtle)]" />
        {title}
      </h2>
      <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-4">{children}</div>
    </section>
  );
}

export function ClosedBoards() {
  const utils = api.useUtils();
  const { data } = api.board.closed.useQuery();
  const reopen = api.board.update.useMutation({ onSuccess: () => utils.board.closed.invalidate() });
  const del = api.board.delete.useMutation({ onSuccess: () => utils.board.closed.invalidate() });
  return (
    <main className="mx-auto w-full max-w-[760px] px-4 py-10">
      <h1 className="mb-6 text-xl font-semibold">Closed boards</h1>
      {data?.length === 0 && <p className="text-[var(--color-text-subtlest)]">No closed boards.</p>}
      {data?.map((b) => (
        <div key={b.id} className="flex items-center gap-3 border-b border-[var(--color-border)] py-3">
          <span className="h-8 w-10 rounded-[3px]" style={boardBg(b)} />
          <div className="min-w-0 flex-1">
            <div className="font-medium">{b.name}</div>
            <div className="text-xs text-[var(--color-text-subtlest)]">{b.workspace.name}</div>
          </div>
          <Button variant="primary" onClick={() => reopen.mutate({ id: b.id, closed: false })}>Reopen</Button>
          <Button variant="danger" onClick={() => del.mutate({ id: b.id })}>Delete</Button>
        </div>
      ))}
    </main>
  );
}

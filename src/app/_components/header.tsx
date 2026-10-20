"use client";

import { formatDistanceToNow } from "date-fns";
import { signOut } from "next-auth/react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";

import { api } from "~/trpc/react";

import { CreateBoardPopover } from "./create-board";
import { ThemePicker } from "./theme";
import { Avatar, Icon, MenuItem, MenuSep, Popover, boardBg, usePopoverState } from "./ui";

type User = { id: string; name?: string | null; image?: string | null; email?: string | null; isAdmin?: boolean };

export function Header({ user, translucent = false }: { user: User; translucent?: boolean }) {
  const recent = usePopoverState();
  const starred = usePopoverState();
  const create = usePopoverState();
  const account = usePopoverState();
  const bell = usePopoverState();
  const btn = translucent
    ? "text-white hover:bg-white/20"
    : "text-[var(--color-text-subtle)] hover:bg-[var(--color-neutral-hover)]";

  return (
    <header
      className={`relative z-20 flex h-12 shrink-0 items-center gap-1 px-2 ${
        translucent ? "bg-black/40" : "border-b border-[var(--color-border)] bg-[var(--color-surface)]"
      }`}
    >
      <Link href="/" className={`flex h-8 items-center gap-1.5 rounded-[3px] px-1.5 text-[17px] font-bold ${translucent ? "text-white hover:bg-white/20" : "text-[var(--color-text)] hover:bg-[var(--color-neutral-hover)]"}`}>
        <svg width="20" height="20" viewBox="0 0 32 32" aria-hidden>
          {/* Hack Club red, on every background */}
          <rect width="32" height="32" rx="6" fill="#ec3750" />
          <rect x="6" y="6" width="8.5" height="18" rx="2" fill="#fff" />
          <rect x="17.5" y="6" width="8.5" height="11" rx="2" fill="#fff" />
        </svg>
        Hackban
      </Link>
      <NavButton cls={btn} onClick={recent.toggle} active={recent.open}>Recent</NavButton>
      <NavButton cls={btn} onClick={starred.toggle} active={starred.open}>Starred</NavButton>
      <button
        onClick={create.toggle}
        className={`ml-1 h-8 rounded-[3px] px-3 text-sm font-medium transition-colors ${translucent ? "bg-white/20 text-white hover:bg-white/30" : "bg-[var(--color-brand)] text-[var(--color-on-brand)] hover:bg-[var(--color-brand-hover)]"}`}
      >
        Create
      </button>
      <div className="flex-1" />
      <SearchBox translucent={translucent} />
      <button onClick={bell.toggle} className={`relative flex h-8 w-8 items-center justify-center rounded-full ${btn}`} aria-label="Notifications">
        <Icon name="bell" />
        <UnreadDot />
      </button>
      <button onClick={account.toggle} className="ml-1 rounded-full p-0.5 hover:bg-black/10" aria-label="Account">
        <Avatar user={user} size={28} />
      </button>

      <Popover open={recent.open} title="Recent boards" anchor={recent.anchor} onClose={recent.close}>
        <RecentBoards onPick={recent.close} />
      </Popover>
      <Popover open={starred.open} title="Starred boards" anchor={starred.anchor} onClose={starred.close}>
        <StarredBoards onPick={starred.close} />
      </Popover>
      <CreateBoardPopover anchor={create.anchor} onClose={create.close} />
      <Popover anchor={bell.anchor} open={bell.open} onClose={bell.close} title="Notifications" width={432}>
        <Notifications onPick={bell.close} />
      </Popover>
      <Popover anchor={account.anchor} open={account.open} onClose={account.close} title="Account">
        <div className="flex items-center gap-3 py-2">
          <Avatar user={user} size={40} />
          <div className="min-w-0">
            <div className="truncate font-medium">{user.name}</div>
            <div className="truncate text-xs text-[var(--color-text-subtlest)]">{user.email}</div>
          </div>
        </div>
        <MenuSep />
        <h3 className="mb-1.5 text-xs font-semibold text-[var(--color-text-subtle)]">Theme</h3>
        <ThemePicker />
        <MenuSep />
        <Link href="/import" onClick={account.close}><MenuItem>Import from Trello</MenuItem></Link>
        <Link href="/me" onClick={account.close}><MenuItem>Profile and settings</MenuItem></Link>
        <Link href="/closed" onClick={account.close}><MenuItem>Closed boards</MenuItem></Link>
        {user.isAdmin && <Link href="/admin" onClick={account.close}><MenuItem>Admin panel</MenuItem></Link>}
        <MenuSep />
        <MenuItem onClick={() => void signOut({ redirectTo: "/login" })}>Log out</MenuItem>
      </Popover>
    </header>
  );
}

function NavButton({ children, cls, onClick, active }: { children: React.ReactNode; cls: string; onClick: (e: React.MouseEvent) => void; active: boolean }) {
  return (
    <button onClick={onClick} className={`flex h-8 items-center gap-1 rounded-[3px] px-2.5 text-sm font-medium transition-colors ${cls} ${active ? "bg-black/10" : ""}`}>
      {children}
      <svg width="12" height="12" viewBox="0 0 24 24" fill="currentColor" aria-hidden><path d="M7 9l5 5 5-5z" /></svg>
    </button>
  );
}

function BoardRow({ b, onPick }: { b: { id: string; name: string; background: string; bgImage?: string | null; workspace?: { name: string } }; onPick: () => void }) {
  return (
    <Link href={`/b/${b.id}`} onClick={onPick} className="-mx-1 flex items-center gap-2 rounded-[3px] p-1 hover:bg-[var(--color-neutral)]">
      <span className="h-8 w-10 shrink-0 rounded-[3px]" style={boardBg(b)} />
      <span className="min-w-0">
        <span className="block truncate text-sm font-medium">{b.name}</span>
        {b.workspace && <span className="block truncate text-xs text-[var(--color-text-subtlest)]">{b.workspace.name}</span>}
      </span>
    </Link>
  );
}

function RecentBoards({ onPick }: { onPick: () => void }) {
  const { data } = api.board.recent.useQuery();
  if (!data?.length) return <p className="py-2 text-sm text-[var(--color-text-subtlest)]">Boards you visit will show up here.</p>;
  return <>{data.map((b) => <BoardRow key={b.id} b={b} onPick={onPick} />)}</>;
}

function StarredBoards({ onPick }: { onPick: () => void }) {
  const { data } = api.workspace.list.useQuery();
  const boards = data?.flatMap((w) => w.boards.filter((b) => b.starred).map((b) => ({ ...b, workspace: { name: w.name } }))) ?? [];
  if (!boards.length) return <p className="py-2 text-sm text-[var(--color-text-subtlest)]">Star important boards to access them quickly and easily.</p>;
  return <>{boards.map((b) => <BoardRow key={b.id} b={b} onPick={onPick} />)}</>;
}

function UnreadDot() {
  const { data } = api.notification.list.useQuery(undefined, { refetchInterval: 60_000 });
  const n = data?.filter((x) => !x.read).length ?? 0;
  if (!n) return null;
  return <span className="absolute top-0.5 right-0.5 h-2.5 w-2.5 rounded-full border-2 border-white bg-[#c9372c]" />;
}

function Notifications({ onPick }: { onPick: () => void }) {
  const utils = api.useUtils();
  const { data } = api.notification.list.useQuery();
  const markRead = api.notification.markAllRead.useMutation({ onSuccess: () => utils.notification.list.invalidate() });
  return (
    <div>
      <div className="mb-2 flex justify-end">
        <button className="text-xs text-[var(--color-brand)] hover:underline" onClick={() => markRead.mutate()}>Mark all as read</button>
      </div>
      {!data?.length && <p className="py-6 text-center text-sm text-[var(--color-text-subtlest)]">No unread notifications</p>}
      {data?.map((n) => (
        <Link
          key={n.id}
          href={`/c/${n.data.cardId}`}
          onClick={onPick}
          className={`mb-2 block rounded-lg border border-[var(--color-border)] p-3 hover:bg-[var(--color-neutral)] ${n.read ? "opacity-70" : ""}`}
        >
          <div className="text-sm">
            <b>{n.data.by}</b>{" "}
            {n.type === "addedToCard" ? "added you to the card" : "commented on the card"} <b>{n.data.title}</b>
          </div>
          {n.data.text && <div className="mt-1 rounded bg-[var(--color-neutral)] p-2 text-sm">{n.data.text}</div>}
          <div className="mt-1 text-xs text-[var(--color-text-subtlest)]">{formatDistanceToNow(n.createdAt, { addSuffix: true })}</div>
        </Link>
      ))}
    </div>
  );
}

function SearchBox({ translucent }: { translucent: boolean }) {
  const [q, setQ] = useState("");
  const [debounced, setDebounced] = useState("");
  const [focus, setFocus] = useState(false);
  const router = useRouter();
  const ref = useRef<HTMLInputElement>(null);
  useEffect(() => {
    const t = setTimeout(() => setDebounced(q), 200);
    return () => clearTimeout(t);
  }, [q]);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement;
      if (e.key === "/" && !/INPUT|TEXTAREA/.test(t.tagName) && !t.isContentEditable) {
        e.preventDefault();
        ref.current?.focus();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);
  const { data } = api.search.query.useQuery({ q: debounced }, { enabled: debounced.length >= 2 });
  const show = focus && debounced.length >= 2 && data;
  return (
    <div className="relative mr-1">
      <div className={`flex h-8 items-center gap-1.5 rounded-[3px] px-2 transition-all ${focus ? "w-[440px] bg-[var(--color-surface)] text-[var(--color-text)] shadow-[inset_0_0_0_2px_var(--color-focus)]" : translucent ? "w-[200px] bg-white/20 text-white hover:bg-white/30" : "w-[200px] shadow-[inset_0_0_0_1px_var(--color-border)]"}`}>
        <Icon name="search" />
        <input
          ref={ref}
          value={q}
          onChange={(e) => setQ(e.target.value)}
          onFocus={() => setFocus(true)}
          onBlur={() => setTimeout(() => setFocus(false), 150)}
          placeholder="Search"
          className={`w-full bg-transparent text-sm outline-none ${focus ? "" : translucent ? "placeholder:text-white" : ""}`}
        />
      </div>
      {show && (
        <div className="absolute top-10 right-0 z-50 w-[440px] rounded-lg bg-[var(--color-surface)] p-3 text-[var(--color-text)] shadow-[var(--shadow-overlay)]">
          {data.cards.length > 0 && <h3 className="mb-1 text-xs font-semibold text-[var(--color-text-subtle)]">CARDS</h3>}
          {data.cards.map((c) => (
            <button key={c.id} onMouseDown={() => router.push(`/c/${c.id}`)} className="-mx-1 flex w-full items-center gap-2 rounded p-1.5 text-left hover:bg-[var(--color-neutral)]">
              <Icon name="card" className="text-[var(--color-text-subtle)]" />
              <span className="min-w-0">
                <span className="block truncate text-sm">{c.title}</span>
                <span className="block truncate text-xs text-[var(--color-text-subtlest)]">{c.list.board.name}: {c.list.name}</span>
              </span>
            </button>
          ))}
          {data.boards.length > 0 && <h3 className="mt-2 mb-1 text-xs font-semibold text-[var(--color-text-subtle)]">BOARDS</h3>}
          {data.boards.map((b) => (
            <button key={b.id} onMouseDown={() => router.push(`/b/${b.id}`)} className="-mx-1 flex w-full items-center gap-2 rounded p-1.5 text-left hover:bg-[var(--color-neutral)]">
              <span className="h-6 w-8 rounded-[3px]" style={boardBg(b)} />
              <span className="truncate text-sm">{b.name}</span>
            </button>
          ))}
          {!data.boards.length && !data.cards.length && <p className="text-sm text-[var(--color-text-subtlest)]">No results for &ldquo;{debounced}&rdquo;</p>}
        </div>
      )}
    </div>
  );
}

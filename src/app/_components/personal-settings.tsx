"use client";

import { format } from "date-fns";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";

import { api, type RouterOutputs } from "~/trpc/react";

import { ActivityItem } from "./board/activity";
import { PageTitle } from "./settings-shell";
import { ThemePicker } from "./theme";
import { Avatar, Button, Icon, boardBg, dueState, dueStyles, inputCls, labelStyle } from "./ui";

export function PersonalPage({ page }: { page: "profile" | "activity" | "cards" | "settings" }) {
  if (page === "activity") return <Activity />;
  if (page === "cards") return <Cards />;
  if (page === "settings") return <Settings />;
  return <Profile />;
}

type Me = RouterOutputs["me"]["profile"];

function AvatarEditor({ me }: { me: Me }) {
  const utils = api.useUtils();
  const router = useRouter();
  const input = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const send = async (method: "POST" | "DELETE", file?: File) => {
    setBusy(true);
    setErr(null);
    const body = file ? new FormData() : undefined;
    if (file) body!.append("file", file);
    const res = await fetch(`/api/users/${me.id}/avatar`, { method, body });
    if (!res.ok) setErr(await res.text());
    await utils.me.profile.invalidate();
    // The header's avatar comes from the server session.
    router.refresh();
    setBusy(false);
  };
  return (
    <div className="shrink-0 text-center">
      <button
        type="button"
        disabled={busy}
        onClick={() => input.current?.click()}
        className="group relative block rounded-full"
        aria-label="Change profile picture"
      >
        <Avatar user={me} size={72} className={`ring-4 ring-white/40 transition-opacity ${busy ? "opacity-50" : ""}`} />
        <span className="absolute inset-0 flex items-center justify-center rounded-full bg-black/50 text-xs font-medium text-white opacity-0 transition-opacity group-hover:opacity-100 group-focus-visible:opacity-100">
          Change
        </span>
      </button>
      <input
        ref={input}
        type="file"
        accept="image/png,image/jpeg,image/gif,image/webp"
        hidden
        onChange={(e) => {
          const f = e.target.files?.[0];
          e.target.value = "";
          if (f && f.size > 2 * 1024 * 1024) setErr("Pictures must be under 2 MB.");
          else if (f) void send("POST", f);
        }}
      />
      {me.avatarKey && (
        <button className="mt-1 text-xs underline opacity-80" disabled={busy} onClick={() => void send("DELETE")}>
          Use Slack photo
        </button>
      )}
      {err && <p className="mt-1 w-24 text-xs">{err}</p>}
    </div>
  );
}

function Profile() {
  const utils = api.useUtils();
  const { data: me } = api.me.profile.useQuery();
  const [name, setName] = useState("");
  const [username, setUsername] = useState("");
  const [saved, setSaved] = useState(false);
  useEffect(() => {
    if (me) {
      setName(me.name ?? "");
      setUsername(me.username ?? "");
    }
  }, [me]);
  const update = api.me.update.useMutation({
    onSuccess: () => {
      void utils.me.profile.invalidate();
      setSaved(true);
      setTimeout(() => setSaved(false), 1500);
    },
  });
  if (!me) return <div className="h-40 animate-pulse rounded bg-[var(--color-neutral)]" />;
  return (
    <div className="max-w-[560px]">
      <div className="-mx-6 mb-8 flex items-end gap-4 rounded-lg bg-gradient-to-r from-[#0c66e4] to-[#6e5dc6] px-6 pt-10 pb-5 text-white md:-mx-0">
        <AvatarEditor me={me} />
        <div className="pb-1">
          <div className="text-xl font-semibold">{me.name}</div>
          <div className="text-sm opacity-80">{me.username ? `@${me.username}` : me.email}</div>
        </div>
      </div>
      <PageTitle sub="Your avatar comes from your Hack Club Slack profile unless you upload your own.">Manage your personal information</PageTitle>
      <label className="mb-1 block text-xs font-bold text-[var(--color-text-subtle)]">Full name</label>
      <input className={inputCls} value={name} onChange={(e) => setName(e.target.value)} />
      <label className="mt-4 mb-1 block text-xs font-bold text-[var(--color-text-subtle)]">Username</label>
      <div className="relative">
        <span className="pointer-events-none absolute top-1/2 left-3 -translate-y-1/2 text-[var(--color-text-subtlest)]">@</span>
        <input className={`${inputCls} pl-7`} value={username} onChange={(e) => setUsername(e.target.value.toLowerCase())} placeholder="username" />
      </div>
      <label className="mt-4 mb-1 block text-xs font-bold text-[var(--color-text-subtle)]">Email</label>
      <input className={`${inputCls} opacity-70`} value={me.email ?? ""} disabled />
      <p className="mt-1 text-xs text-[var(--color-text-subtlest)]">Managed by Hack Club Auth.</p>
      {me.trelloId && <p className="mt-4 text-sm text-[var(--color-text-subtle)]">✓ Linked to your Trello account (imported history is yours).</p>}
      <div className="mt-6 flex items-center gap-3">
        <Button
          variant="primary"
          disabled={!name.trim() || update.isPending}
          onClick={() => update.mutate({ name: name.trim(), username: username.trim() || null })}
        >
          Save
        </Button>
        {saved && <span className="text-sm text-[var(--color-success)]">Saved</span>}
        {update.error && <span className="text-sm text-[var(--color-danger)]">{update.error.data?.zodError ? "Usernames are 2–32 lowercase letters, numbers or underscores." : update.error.message}</span>}
      </div>
      <p className="mt-8 text-xs text-[var(--color-text-subtlest)]">Member since {format(me.createdAt, "MMMM yyyy")}</p>
    </div>
  );
}

function Activity() {
  const q = api.me.activity.useInfiniteQuery({}, { getNextPageParam: (p) => p.next });
  const items = q.data?.pages.flatMap((p) => p.items) ?? [];
  return (
    <div className="max-w-[720px]">
      <PageTitle>Activity</PageTitle>
      {items.map((a) => (
        <div key={a.id} className="border-b border-[var(--color-border)]">
          <Link href={a.card ? `/c/${a.card.id}` : `/b/${a.board.id}`} className="block hover:bg-[var(--color-neutral)]">
            <ActivityItem a={a} />
          </Link>
          <div className="-mt-1 pb-2 pl-10 text-xs text-[var(--color-text-subtlest)]">on {a.board.name}</div>
        </div>
      ))}
      {q.data && items.length === 0 && <p className="text-sm text-[var(--color-text-subtle)]">Nothing yet.</p>}
      {q.hasNextPage && <Button className="mt-4" onClick={() => void q.fetchNextPage()}>Load more activity</Button>}
    </div>
  );
}

function Cards() {
  const { data } = api.me.cards.useQuery();
  const [sort, setSort] = useState<"board" | "due">("board");
  const groups = new Map<string, NonNullable<typeof data>>();
  for (const c of data ?? []) {
    const k = sort === "board" ? c.list.board.id : c.due ? format(c.due, "yyyy-MM") : "none";
    groups.set(k, [...(groups.get(k) ?? []), c]);
  }
  return (
    <div>
      <PageTitle sub="Open cards you're a member of.">Cards</PageTitle>
      <div className="mb-6 flex gap-1 rounded-[3px] bg-[var(--color-neutral)] p-0.5 sm:w-72">
        {(["board", "due"] as const).map((s) => (
          <button
            key={s}
            onClick={() => setSort(s)}
            className={`h-8 flex-1 rounded-[3px] text-sm font-medium ${sort === s ? "bg-[var(--color-surface)] shadow-[var(--shadow-card)]" : ""}`}
          >
            {s === "board" ? "By board" : "By due date"}
          </button>
        ))}
      </div>
      {data?.length === 0 && <p className="text-sm text-[var(--color-text-subtle)]">You&apos;re not on any open cards.</p>}
      {[...groups].map(([k, cards]) => {
        const b = cards[0]!.list.board;
        return (
          <section key={k} className="mb-8">
            <h2 className="mb-3 flex items-center gap-2 font-semibold">
              {sort === "board" ? (
                <>
                  <span className="h-6 w-8 rounded-[3px]" style={boardBg(b)} />
                  <Link href={`/b/${b.id}`} className="hover:underline">{b.name}</Link>
                </>
              ) : k === "none" ? (
                "No due date"
              ) : (
                format(cards[0]!.due!, "MMMM yyyy")
              )}
            </h2>
            <div className="grid grid-cols-1 gap-2 sm:grid-cols-2 lg:grid-cols-3">
              {cards.map((c) => {
                const due = dueState(c.due, c.dueComplete);
                return (
                  <Link key={c.id} href={`/c/${c.id}`} className="block rounded-lg bg-[var(--color-surface)] px-3 py-2 shadow-[var(--shadow-card)] hover:outline-2 hover:outline-[var(--color-focus)]">
                    {c.labels.length > 0 && (
                      <div className="mb-1 flex flex-wrap gap-1">
                        {c.labels.map(({ label }) => <span key={label.id} className="h-2 w-10 rounded-full" style={labelStyle(label.color)} />)}
                      </div>
                    )}
                    <div className="text-sm">{c.title}</div>
                    <div className="mt-1 flex items-center gap-2 text-xs text-[var(--color-text-subtle)]">
                      {c.due && (
                        <span className={`flex items-center gap-1 rounded-[3px] px-1 ${due ? dueStyles[due] : ""}`}>
                          <Icon name="clock" size={12} /> {format(c.due, "MMM d")}
                        </span>
                      )}
                      <span className="truncate">{sort === "due" ? `${c.list.board.name} · ` : ""}{c.list.name}</span>
                    </div>
                  </Link>
                );
              })}
            </div>
          </section>
        );
      })}
    </div>
  );
}

function Settings() {
  return (
    <div className="max-w-[560px]">
      <PageTitle>Settings</PageTitle>
      <h2 className="mb-2 font-semibold">Theme</h2>
      <div className="w-72"><ThemePicker /></div>
      <ConnectedApps />
      <h2 className="mt-8 mb-2 font-semibold">Keyboard shortcuts</h2>
      <table className="text-sm">
        <tbody>
          {[
            ["Enter", "Open hovered card"],
            ["e", "Quick-edit hovered card (or right-click)"],
            ["d", "Mark hovered card complete"],
            ["c", "Archive hovered card"],
            ["Space", "Join / leave hovered card"],
            ["1–0", "Toggle labels on hovered card"],
            ["q", "Show only my cards"],
            ["x", "Clear filters"],
            ["w", "Toggle board menu"],
            ["/", "Search"],
            ["Esc", "Close"],
          ].map(([k, d]) => (
            <tr key={k}>
              <td className="py-1 pr-4"><kbd className="rounded bg-[var(--color-neutral)] px-1.5 py-0.5 font-mono text-xs">{k}</kbd></td>
              <td className="py-1 text-[var(--color-text-subtle)]">{d}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function GitHubAccount() {
  const utils = api.useUtils();
  const { data } = api.me.github.useQuery();
  const disconnect = api.me.disconnectGithub.useMutation({ onSuccess: () => void utils.me.github.invalidate() });
  const [flash, setFlash] = useState<string | null>(null);
  useEffect(() => {
    const q = new URLSearchParams(location.search).get("github");
    if (q) {
      setFlash(q === "connected" ? "GitHub connected." : "Connecting GitHub didn't work. Try again.");
      history.replaceState(null, "", location.pathname);
    }
  }, []);
  if (!data?.available) return null;
  return (
    <>
      <h2 className="mt-8 mb-2 font-semibold">GitHub</h2>
      <p className="mb-2 text-sm text-[var(--color-text-subtle)]">
        Cards track GitHub issues you link to them and complete when the issue closes. Public issues work without this; connect your account to track issues in private repos you can see.
      </p>
      {flash && <p className="mb-2 text-sm">{flash}</p>}
      {data.connection ? (
        <div className="flex items-center justify-between gap-3 rounded-[3px] bg-[var(--color-neutral)] px-3 py-2 text-sm">
          <div className="min-w-0">
            <div className="truncate font-medium">@{data.connection.login}</div>
            <div className="text-xs text-[var(--color-text-subtlest)]">Connected {format(data.connection.createdAt, "MMM d, yyyy")}</div>
          </div>
          <Button variant="danger" disabled={disconnect.isPending} onClick={() => disconnect.mutate()}>
            Disconnect
          </Button>
        </div>
      ) : (
        <Button onClick={() => location.assign("/api/github/connect")}>Connect GitHub</Button>
      )}
    </>
  );
}

function ConnectedApps() {
  const utils = api.useUtils();
  const { data: apps } = api.me.apps.useQuery();
  const revoke = api.me.revokeApp.useMutation({ onSuccess: () => void utils.me.apps.invalidate() });
  const [url, setUrl] = useState("");
  useEffect(() => setUrl(`${location.origin}/api/mcp`), []);
  return (
    <>
      <GitHubAccount />
      <h2 className="mt-8 mb-2 font-semibold">Connected apps</h2>
      <p className="mb-2 text-sm text-[var(--color-text-subtle)]">
        Add this URL as an MCP server (a custom connector) in Claude, Cursor or any MCP client to let it work with your boards.
      </p>
      <input className={`${inputCls} font-mono text-xs`} value={url} readOnly onFocus={(e) => e.target.select()} aria-label="MCP server URL" />
      {apps?.map((a) => (
        <div key={a.id} className="mt-2 flex items-center justify-between gap-3 rounded-[3px] bg-[var(--color-neutral)] px-3 py-2 text-sm">
          <div className="min-w-0">
            <div className="truncate font-medium">{a.name}</div>
            <div className="text-xs text-[var(--color-text-subtlest)]">Last active {format(a.lastActive, "MMM d, yyyy")}</div>
          </div>
          <Button variant="danger" disabled={revoke.isPending} onClick={() => revoke.mutate({ id: a.id })}>
            Revoke
          </Button>
        </div>
      ))}
    </>
  );
}

"use client";

import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";

import { api, type RouterOutputs } from "~/trpc/react";

import { CreateBoardPopover } from "./create-board";
import { BoardTile } from "./home";
import { PageTitle } from "./settings-shell";
import { AutoTextarea, Avatar, Button, Icon, MenuItem, Popover, boardBg, inputCls, looksLikeEmail, useFavicon, usePopoverState, WorkspaceLogo } from "./ui";

type Page = "boards" | "members" | "settings" | "export";

/** One page of the workspace settings surface (rendered inside SettingsShell). */
export function WorkspacePage({ id, meId, page }: { id: string; meId: string; page: Page }) {
  const { data: ws, error } = api.workspace.get.useQuery({ id });
  useFavicon(ws?.logo);
  if (error) return <p className="mt-24 text-center text-[var(--color-text-subtle)]">Workspace not found, or you&apos;re not a member.</p>;
  if (!ws) return <div className="h-40 w-full animate-pulse rounded bg-[var(--color-neutral)]" />;
  const isAdmin = ws.myRole === "admin";
  if (page === "boards") return <Boards ws={ws} />;
  if (page === "export") return <Export ws={ws} />;
  if (page === "members") {
    return (
      <>
        <PageTitle sub="Workspace members can view and join all workspace-visible boards.">Members ({ws.members.length})</PageTitle>
        <Members ws={ws} meId={meId} isAdmin={isAdmin} />
      </>
    );
  }
  return (
    <>
      <PageTitle>Settings</PageTitle>
      <Identity ws={ws} isAdmin={isAdmin} />
      <hr className="my-8 border-[var(--color-border)]" />
      <AutoJoinSettings workspaceId={ws.id} canEdit={isAdmin} />
      <hr className="my-8 border-[var(--color-border)]" />
      <Danger ws={ws} meId={meId} isAdmin={isAdmin} />
    </>
  );
}

type WS = RouterOutputs["workspace"]["get"];

function LogoEditor({ ws, isAdmin }: { ws: WS; isAdmin: boolean }) {
  const utils = api.useUtils();
  const input = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const refresh = () => Promise.all([utils.workspace.get.invalidate({ id: ws.id }), utils.workspace.list.invalidate()]);
  const send = async (method: "POST" | "DELETE", file?: File) => {
    setBusy(true);
    setErr(null);
    const body = file ? new FormData() : undefined;
    if (file) body!.append("file", file);
    const res = await fetch(`/api/workspaces/${ws.id}/logo`, { method, body });
    if (!res.ok) setErr(await res.text());
    await refresh();
    setBusy(false);
  };
  return (
    <div className="shrink-0 text-center">
      <button
        type="button"
        disabled={!isAdmin || busy}
        onClick={() => input.current?.click()}
        className="group relative block rounded-lg disabled:cursor-default"
        aria-label="Change workspace logo"
      >
        <WorkspaceLogo ws={ws} size={64} className={`rounded-lg transition-opacity ${busy ? "opacity-50" : ""}`} />
        {isAdmin && (
          <span className="absolute inset-0 flex items-center justify-center rounded-lg bg-black/50 text-xs font-medium text-white opacity-0 transition-opacity group-hover:opacity-100">
            Change
          </span>
        )}
      </button>
      <input
        ref={input}
        type="file"
        accept="image/png,image/jpeg,image/gif,image/webp"
        hidden
        onChange={(e) => {
          const f = e.target.files?.[0];
          e.target.value = "";
          if (f) void send("POST", f);
        }}
      />
      {isAdmin && ws.logo && (
        <button className="mt-1 text-xs text-[var(--color-text-subtle)] underline" onClick={() => void send("DELETE")}>
          Remove
        </button>
      )}
      {err && <p className="mt-1 w-24 text-xs text-[var(--color-danger)]">{err}</p>}
    </div>
  );
}

function Identity({ ws, isAdmin }: { ws: WS; isAdmin: boolean }) {
  const utils = api.useUtils();
  const [editing, setEditing] = useState(false);
  const [name, setName] = useState(ws.name);
  const [description, setDescription] = useState(ws.description ?? "");
  useEffect(() => {
    setName(ws.name);
    setDescription(ws.description ?? "");
  }, [ws.name, ws.description]);
  const update = api.workspace.update.useMutation({
    onSuccess: () => {
      setEditing(false);
      void utils.workspace.get.invalidate({ id: ws.id });
      void utils.workspace.list.invalidate();
    },
  });
  return (
    <div className="flex items-start gap-4">
      <LogoEditor ws={ws} isAdmin={isAdmin} />
      {editing ? (
        <div className="flex-1 space-y-2">
          <div>
            <label className="mb-1 block text-xs font-bold text-[var(--color-text-subtle)]">Name</label>
            <input autoFocus className={inputCls} value={name} onChange={(e) => setName(e.target.value)} />
          </div>
          <div>
            <label className="mb-1 block text-xs font-bold text-[var(--color-text-subtle)]">Description (optional)</label>
            <AutoTextarea minRows={3} className={inputCls} value={description} onChange={(e) => setDescription(e.target.value)} />
          </div>
          <div className="flex gap-1">
            <Button variant="primary" disabled={!name.trim() || update.isPending} onClick={() => update.mutate({ id: ws.id, name: name.trim(), description })}>
              Save
            </Button>
            <Button variant="subtle" onClick={() => setEditing(false)}>Cancel</Button>
          </div>
        </div>
      ) : (
        <div className="min-w-0 flex-1">
          <h1 className="flex items-center gap-2 text-xl font-semibold">
            {ws.name}
            {isAdmin && (
              <button onClick={() => setEditing(true)} className="rounded p-1 text-[var(--color-text-subtle)] hover:bg-[var(--color-neutral)]" aria-label="Edit workspace details">
                <Icon name="edit" size={14} />
              </button>
            )}
          </h1>
          <p className="mt-1 text-sm whitespace-pre-wrap text-[var(--color-text-subtle)]">
            {ws.description ?? (isAdmin ? "Add a description so people know what this workspace is for." : "")}
          </p>
        </div>
      )}
    </div>
  );
}

function Members({ ws, meId, isAdmin }: { ws: WS; meId: string; isAdmin: boolean }) {
  const utils = api.useUtils();
  const siteAdmin = api.me.profile.useQuery().data?.isAdmin ?? false;
  const router = useRouter();
  const [q, setQ] = useState("");
  const [filter, setFilter] = useState("");
  const [confirm, setConfirm] = useState<string | null>(null);
  const inv = () => {
    void utils.workspace.get.invalidate({ id: ws.id });
    void utils.workspace.list.invalidate();
  };
  const { data: found } = api.board.searchUsers.useQuery({ q }, { enabled: q.length >= 2 });
  const add = api.workspace.addMember.useMutation({ onSuccess: inv });
  const remove = api.workspace.removeMember.useMutation({
    onSuccess: (_d, v) => {
      inv();
      if (v.userId === meId) router.push("/");
    },
  });
  const err = add.error ?? remove.error;
  const shown = ws.members.filter((m) => (m.user.name ?? "").toLowerCase().includes(filter.toLowerCase()));

  return (
    <div>
      <section className="mb-8">
        <h2 className="mb-1 font-semibold">Invite members</h2>
        <p className="mb-2 text-sm text-[var(--color-text-subtle)]">Search by name, or enter an email to invite someone who hasn&apos;t logged in yet. They join when they first log in.</p>
        <div className="relative max-w-md">
          <input className={inputCls} placeholder="Name or email" value={q} onChange={(e) => setQ(e.target.value)} />
          {found && q.length >= 2 && (
            <div className="absolute top-11 right-0 left-0 z-10 rounded-lg bg-[var(--color-overlay)] px-3 py-2 shadow-[var(--shadow-overlay)]">
              {found.filter((u) => !ws.members.some((m) => m.userId === u.id)).map((u) => (
                <MenuItem key={u.id} onClick={() => { add.mutate({ id: ws.id, userId: u.id }); setQ(""); }}>
                  <span className="flex items-center gap-2">
                    <Avatar user={u} size={24} /> {u.name}
                    <span className="truncate text-xs text-[var(--color-text-subtlest)]">{u.isGhost ? "(imported from Trello)" : u.email}</span>
                  </span>
                </MenuItem>
              ))}
              {found.length === 0 && looksLikeEmail(q) ? (
                <MenuItem onClick={() => { add.mutate({ id: ws.id, email: q.trim() }); setQ(""); }}>Invite {q.trim()}</MenuItem>
              ) : (
                found.filter((u) => !ws.members.some((m) => m.userId === u.id)).length === 0 && (
                  <p className="py-1 text-sm text-[var(--color-text-subtlest)]">No one new found.</p>
                )
              )}
            </div>
          )}
        </div>
      </section>

      <section>
        <div className="mb-2 flex items-center justify-between gap-3">
          <h2 className="font-semibold">Workspace members ({ws.members.length})</h2>
          <input className={`${inputCls} max-w-56`} placeholder="Filter by name" value={filter} onChange={(e) => setFilter(e.target.value)} />
        </div>
        {err && <p className="mb-2 text-sm text-[var(--color-danger)]">{err.message === "FORBIDDEN" ? "Only workspace admins can do that." : err.message}</p>}
        {shown.map((m) => {
          const self = m.userId === meId;
          return (
            <div key={m.userId} className="flex items-center gap-3 border-b border-[var(--color-border)] py-3">
              <Avatar user={m.user} size={36} />
              <div className="min-w-0 flex-1">
                <div className="truncate text-sm font-medium">
                  {m.user.name} {self && <span className="text-xs text-[var(--color-text-subtlest)]">(you)</span>}
                </div>
                <div className="truncate text-xs text-[var(--color-text-subtlest)]">{m.user.invitedEmail ? `Invited as ${m.user.invitedEmail}, hasn't logged in yet` : m.user.isGhost ? "Imported from Trello, hasn't logged in yet" : m.user.email}</div>
              </div>
              {isAdmin ? (
                <select
                  className="h-8 rounded-[3px] bg-[var(--color-neutral)] px-2 text-sm"
                  value={m.role}
                  onChange={(e) => add.mutate({ id: ws.id, userId: m.userId, role: e.target.value as "admin" | "normal" })}
                >
                  <option value="admin">Admin</option>
                  <option value="normal">Member</option>
                </select>
              ) : (
                <span className="text-sm text-[var(--color-text-subtle)]">{m.role === "admin" ? "Admin" : "Member"}</span>
              )}
              {siteAdmin && m.user.isGhost && !m.user.invitedEmail && <LinkGhost wsId={ws.id} ghost={m.user} />}
              {(isAdmin || self) &&
                (confirm === m.userId ? (
                  <Button variant="danger" onClick={() => remove.mutate({ id: ws.id, userId: m.userId })}>
                    {self ? "Really leave?" : "Really remove?"}
                  </Button>
                ) : (
                  <Button onClick={() => setConfirm(m.userId)} onBlur={() => setConfirm(null)}>
                    {self ? "Leave" : "Remove"}
                  </Button>
                ))}
            </div>
          );
        })}
      </section>
    </div>
  );
}

/**
 * "Link account…": merge an imported Trello placeholder into the real person's
 * Hackban account (Trello never shares emails, so this can't be automatic).
 */
function LinkGhost({ wsId, ghost }: { wsId: string; ghost: { id: string; name: string | null; image: string | null } }) {
  const utils = api.useUtils();
  const pop = usePopoverState();
  const [q, setQ] = useState(ghost.name?.split(" ")[0] ?? "");
  const [pick, setPick] = useState<{ id: string; name: string | null; image: string | null; email: string | null } | null>(null);
  const { data: found } = api.board.searchUsers.useQuery({ q }, { enabled: pop.open && q.length >= 2 });
  const link = api.workspace.linkGhost.useMutation({
    onSuccess: () => {
      pop.close();
      void utils.workspace.get.invalidate({ id: wsId });
      void utils.workspace.list.invalidate();
    },
  });
  const close = () => {
    pop.close();
    setPick(null);
    link.reset();
  };
  return (
    <>
      <Button onClick={pop.toggle}>Link account…</Button>
      <Popover anchor={pop.anchor} open={pop.open} onClose={close} title={pick ? "Link this account?" : `Link ${ghost.name ?? "member"}`} onBack={pick ? () => setPick(null) : undefined} width={340}>
        {!pick ? (
          <>
            <p className="mb-2 text-xs text-[var(--color-text-subtle)]">
              Pick the Hackban account that belongs to this Trello member. They need to have logged in once.
            </p>
            <input autoFocus className={inputCls} value={q} onChange={(e) => setQ(e.target.value)} placeholder="Name or email" />
            <div className="mt-1">
              {found
                ?.filter((u) => !u.isGhost)
                .map((u) => (
                  <MenuItem key={u.id} onClick={() => setPick(u)}>
                    <span className="flex items-center gap-2">
                      <Avatar user={u} size={28} />
                      <span className="min-w-0">
                        <span className="block truncate">{u.name}</span>
                        <span className="block truncate text-xs text-[var(--color-text-subtlest)]">{u.email}</span>
                      </span>
                    </span>
                  </MenuItem>
                ))}
              {found?.every((u) => u.isGhost) && (
                <p className="py-2 text-sm text-[var(--color-text-subtlest)]">No one found. Ask them to log in to Hackban first.</p>
              )}
            </div>
          </>
        ) : (
          <>
            <div className="my-2 flex items-center justify-center gap-3">
              <Avatar user={ghost} size={36} />
              <Icon name="back" className="rotate-180 text-[var(--color-text-subtle)]" />
              <Avatar user={pick} size={36} />
            </div>
            <p className="mb-3 text-sm">
              <b>{ghost.name}</b> (imported) becomes <b>{pick.name}</b>. Their cards, comments, checklist items and board access all move to {pick.email ?? "that account"}. This can&apos;t be undone.
            </p>
            <Button variant="primary" className="w-full" disabled={link.isPending} onClick={() => link.mutate({ id: wsId, ghostId: ghost.id, userId: pick.id })}>
              {link.isPending ? "Linking…" : "Link account"}
            </Button>
          </>
        )}
        {link.error && <p className="mt-2 text-xs text-[var(--color-danger)]">{link.error.message}</p>}
      </Popover>
    </>
  );
}

type Sort = "active" | "inactive" | "az" | "za";

function Boards({ ws }: { ws: WS }) {
  const [sort, setSort] = useState<Sort>("active");
  const [filter, setFilter] = useState<"all" | "starred" | "private" | "workspace" | "public">("all");
  const [q, setQ] = useState("");
  const [showClosed, setShowClosed] = useState(false);
  const [create, setCreate] = useState<HTMLElement | null>(null);
  const boards = ws.boards
    .filter((b) => b.closed === showClosed)
    .filter((b) => (filter === "all" ? true : filter === "starred" ? b.starred : b.visibility === filter))
    .filter((b) => b.name.toLowerCase().includes(q.toLowerCase()))
    .sort((a, b) =>
      sort === "az"
        ? a.name.localeCompare(b.name)
        : sort === "za"
          ? b.name.localeCompare(a.name)
          : (sort === "active" ? -1 : 1) * (a.lastActive.getTime() - b.lastActive.getTime()),
    );
  const selCls =
    "h-10 w-full appearance-none rounded-[3px] bg-[var(--color-surface)] px-3 pr-8 text-sm shadow-[inset_0_0_0_1px_var(--color-border)] outline-none focus:shadow-[inset_0_0_0_2px_var(--color-focus)]";

  return (
    <div>
      <PageTitle>{showClosed ? "Closed boards" : "Boards"}</PageTitle>
      <div className="mb-8 flex flex-wrap items-end gap-2">
        <label className="w-56">
          <span className="mb-1 block text-xs font-semibold text-[var(--color-text-subtle)]">Sort by</span>
          <span className="relative block">
            <select className={selCls} value={sort} onChange={(e) => setSort(e.target.value as Sort)}>
              <option value="active">Most recently active</option>
              <option value="inactive">Least recently active</option>
              <option value="az">Alphabetically A–Z</option>
              <option value="za">Alphabetically Z–A</option>
            </select>
            <Icon name="chevronDown" className="pointer-events-none absolute top-1/2 right-2.5 -translate-y-1/2" />
          </span>
        </label>
        <label className="w-56">
          <span className="mb-1 block text-xs font-semibold text-[var(--color-text-subtle)]">Filter by</span>
          <span className="relative block">
            <select className={selCls} value={filter} onChange={(e) => setFilter(e.target.value as typeof filter)}>
              <option value="all">All boards</option>
              <option value="starred">Starred</option>
              <option value="private">Private</option>
              <option value="workspace">Workspace visible</option>
              <option value="public">Public</option>
            </select>
            <Icon name="chevronDown" className="pointer-events-none absolute top-1/2 right-2.5 -translate-y-1/2" />
          </span>
        </label>
        <label className="ml-auto w-72">
          <span className="mb-1 block text-xs font-semibold text-[var(--color-text-subtle)]">Search</span>
          <span className="relative block">
            <Icon name="search" className="pointer-events-none absolute top-1/2 left-3 -translate-y-1/2 text-[var(--color-text-subtle)]" />
            <input className={`${inputCls} h-10 pl-9`} placeholder="Search boards" value={q} onChange={(e) => setQ(e.target.value)} />
          </span>
        </label>
      </div>

      <div className="grid grid-cols-1 gap-6 sm:grid-cols-2 lg:grid-cols-4">
        {!showClosed && (
          <button
            onClick={(e) => setCreate(e.currentTarget)}
            className="group h-24 rounded-[3px] p-[2px] transition-transform hover:-translate-y-0.5 active:translate-y-0"
            style={{ background: "linear-gradient(135deg, #9f8fef, #579dff 35%, #4bce97 70%, #f5cd47)" }}
          >
            <span className="flex h-full w-full items-center justify-center rounded-[2px] bg-[var(--color-surface)] text-sm text-[var(--color-text-subtle)] transition-colors group-hover:bg-[var(--color-surface-hover)] group-hover:text-[var(--color-text)]">
              Create new board
            </span>
          </button>
        )}
        {boards.map((b) => (
          <div key={b.id} className={b.closed ? "opacity-70" : ""}>
            <BoardTile b={b}>
              {b.visibility === "private" && <Icon name="lock" size={12} className="relative mt-1 opacity-80" />}
            </BoardTile>
          </div>
        ))}
      </div>
      {boards.length === 0 && (q || filter !== "all" || showClosed) && (
        <p className="mt-6 text-sm text-[var(--color-text-subtle)]">No boards match.</p>
      )}

      <Button className="mt-10" onClick={() => setShowClosed(!showClosed)}>
        {showClosed ? "View open boards" : "View closed boards"}
      </Button>
      <CreateBoardPopover key={ws.id} anchor={create ? { el: create } : null} workspaceId={ws.id} onClose={() => setCreate(null)} />
    </div>
  );
}

function Export({ ws }: { ws: WS }) {
  const open = ws.boards.filter((b) => !b.closed);
  return (
    <div>
      <PageTitle sub="Download any board as JSON: lists, cards, labels, checklists, comments and members. Attachments are included as links.">
        Export
      </PageTitle>
      {ws.boards.map((b) => (
        <div key={b.id} className="flex items-center gap-3 border-b border-[var(--color-border)] py-3">
          <span className="h-8 w-11 shrink-0 rounded-[3px]" style={boardBg(b)} />
          <span className="min-w-0 flex-1 truncate text-sm font-medium">
            {b.name} {b.closed && <span className="text-xs text-[var(--color-text-subtlest)]">(closed)</span>}
          </span>
          <a href={`/api/boards/${b.id}/export`} download>
            <Button>
              <Icon name="download" size={14} /> JSON
            </Button>
          </a>
        </div>
      ))}
      {open.length === 0 && <p className="text-sm text-[var(--color-text-subtle)]">No boards to export.</p>}
    </div>
  );
}

/**
 * Domain auto-join rules: anyone logging in with an email on the domain joins
 * this workspace. Shared with the admin panel (which can add any domain).
 */
export function AutoJoinSettings({ workspaceId, canEdit }: { workspaceId: string; canEdit: boolean }) {
  const utils = api.useUtils();
  const { data: rules } = api.workspace.autoJoins.useQuery({ id: workspaceId });
  const { data: me } = api.me.profile.useQuery();
  const myDomain = me?.email?.split("@")[1]?.toLowerCase() ?? "";
  const [domain, setDomain] = useState<string | null>(null);
  const [role, setRole] = useState<"normal" | "admin">("normal");
  const [result, setResult] = useState<string | null>(null);
  const refresh = () => Promise.all([utils.workspace.autoJoins.invalidate({ id: workspaceId }), utils.workspace.get.invalidate({ id: workspaceId })]);
  const add = api.workspace.addAutoJoin.useMutation({
    onSuccess: ({ rule, added }) => {
      void refresh();
      setDomain(null);
      setResult(`Anyone with an @${rule.domain} email now joins automatically.${added ? ` Added ${added} existing ${added === 1 ? "person" : "people"}.` : ""}`);
    },
  });
  const remove = api.workspace.removeAutoJoin.useMutation({ onSuccess: refresh });
  const value = domain ?? myDomain;

  return (
    <section>
      <h2 className="mb-1 font-semibold">Auto-join by email domain</h2>
      <p className="mb-4 text-sm text-[var(--color-text-subtle)]">
        Anyone who logs in with a matching email is added to this workspace automatically, including people who already have an account.
      </p>
      {rules && rules.length > 0 && (
        <div className="mb-4 overflow-hidden rounded-lg border border-[var(--color-border)]">
          {rules.map((r) => (
            <div key={r.id} className="flex items-center gap-3 border-b border-[var(--color-border)] px-4 py-3 last:border-b-0">
              <span className="flex h-8 w-8 items-center justify-center rounded-full bg-[var(--color-brand-subtle)] text-[var(--color-brand)]">
                <Icon name="people" size={14} />
              </span>
              <div className="min-w-0 flex-1">
                <div className="text-sm font-medium">@{r.domain}</div>
                <div className="text-xs text-[var(--color-text-subtlest)]">
                  Joins as {r.role === "admin" ? "Admin" : "Member"} · {r.memberCount} current member{r.memberCount === 1 ? "" : "s"}
                  {r.createdBy?.name ? ` · added by ${r.createdBy.name}` : ""}
                </div>
              </div>
              {canEdit && (
                <Button onClick={() => remove.mutate({ id: workspaceId, ruleId: r.id })} title="Stop auto-adding people. Existing members stay.">
                  Remove
                </Button>
              )}
            </div>
          ))}
        </div>
      )}
      {rules?.length === 0 && !canEdit && <p className="text-sm text-[var(--color-text-subtlest)]">No auto-join rules.</p>}
      {canEdit && (
        <form
          className="flex flex-wrap items-center gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            setResult(null);
            add.mutate({ id: workspaceId, domain: value, role });
          }}
        >
          <div className="relative w-64">
            <span className="pointer-events-none absolute top-1/2 left-3 -translate-y-1/2 text-[var(--color-text-subtlest)]">@</span>
            <input className={`${inputCls} pl-7`} value={value} onChange={(e) => setDomain(e.target.value)} placeholder="hackclub.com" />
          </div>
          <select className="h-9 rounded-[3px] bg-[var(--color-neutral)] px-2 text-sm" value={role} onChange={(e) => setRole(e.target.value as typeof role)}>
            <option value="normal">as Member</option>
            <option value="admin">as Admin</option>
          </select>
          <Button variant="primary" type="submit" disabled={!value.trim() || add.isPending}>
            {add.isPending ? "Adding…" : "Add rule"}
          </Button>
        </form>
      )}
      {canEdit && <p className="mt-2 text-xs text-[var(--color-text-subtlest)]">You can add your own domain. Site admins can add any domain from the admin panel.</p>}
      {result && <p className="mt-2 text-sm text-[var(--color-success)]">{result}</p>}
      {(add.error ?? remove.error) && <p className="mt-2 text-sm text-[var(--color-danger)]">{(add.error ?? remove.error)!.message}</p>}
    </section>
  );
}

function Danger({ ws, meId, isAdmin }: { ws: WS; meId: string; isAdmin: boolean }) {
  const router = useRouter();
  const utils = api.useUtils();
  const [confirmName, setConfirmName] = useState("");
  const del = api.workspace.delete.useMutation({
    onSuccess: () => {
      void utils.workspace.list.invalidate();
      router.push("/");
    },
  });
  const leave = api.workspace.removeMember.useMutation({
    onSuccess: () => {
      void utils.workspace.list.invalidate();
      router.push("/");
    },
  });
  return (
    <div className="space-y-8">
      <section>
        <h2 className="mb-1 font-semibold">Leave workspace</h2>
        <p className="mb-2 text-sm text-[var(--color-text-subtle)]">You&apos;ll lose access to its workspace-visible boards and be removed from its boards.</p>
        <Button onClick={() => leave.mutate({ id: ws.id, userId: meId })}>Leave {ws.name}</Button>
        {leave.error && <p className="mt-1 text-sm text-[var(--color-danger)]">{leave.error.message}</p>}
      </section>
      {isAdmin && (
        <section className="rounded-lg border border-[var(--color-danger)] p-4">
          <h2 className="mb-1 font-semibold text-[var(--color-danger)]">Delete workspace</h2>
          <p className="mb-3 text-sm text-[var(--color-text-subtle)]">
            Permanently deletes this workspace and <b>all {ws.boards.length} of its boards</b>, including their cards, comments and attachments. This can&apos;t be undone.
          </p>
          <label className="mb-1 block text-xs font-bold text-[var(--color-text-subtle)]">Type “{ws.name}” to confirm</label>
          <input className={`${inputCls} max-w-md`} value={confirmName} onChange={(e) => setConfirmName(e.target.value)} />
          <Button variant="danger" className="mt-3" disabled={confirmName !== ws.name || del.isPending} onClick={() => del.mutate({ id: ws.id, confirmName })}>
            Delete workspace
          </Button>
          {del.error && <p className="mt-1 text-sm text-[var(--color-danger)]">{del.error.message}</p>}
        </section>
      )}
    </div>
  );
}

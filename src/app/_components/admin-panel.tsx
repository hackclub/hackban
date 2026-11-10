"use client";

import { formatDistanceToNow } from "date-fns";
import Link from "next/link";
import { useEffect, useState } from "react";

import { api } from "~/trpc/react";

import { Avatar, Button, Icon, boardBg, inputCls, WorkspaceLogo } from "./ui";

type Tab = "overview" | "users" | "boards" | "workspaces" | "autojoin" | "imports";

export function AdminPanel({ meId }: { meId: string }) {
  const [tab, setTab] = useState<Tab>("overview");
  return (
    <div className="mx-auto flex w-full max-w-[1100px] gap-8 px-4 py-10">
      <nav className="w-48 shrink-0">
        <h1 className="mb-4 flex items-center gap-2 px-2 text-lg font-semibold">
          <Icon name="lock" /> Admin
        </h1>
        {(["overview", "users", "boards", "workspaces", "autojoin", "imports"] as const).map((t) => (
          <button
            key={t}
            onClick={() => setTab(t)}
            className={`mb-0.5 flex h-9 w-full items-center rounded-[3px] px-2 text-left text-sm font-medium capitalize transition-colors ${
              tab === t ? "bg-[var(--color-brand-subtle)] text-[var(--color-brand)]" : "hover:bg-[var(--color-neutral)]"
            }`}
          >
            {t === "autojoin" ? "Auto-join" : t}
          </button>
        ))}
      </nav>
      <main key={tab} className="animate-pop-in min-w-0 flex-1">
        {tab === "overview" && <Overview />}
        {tab === "users" && <Users meId={meId} />}
        {tab === "boards" && <Boards />}
        {tab === "workspaces" && <Workspaces />}
        {tab === "autojoin" && <AutoJoin />}
        {tab === "imports" && <Imports />}
      </main>
    </div>
  );
}

function useDebounced(v: string) {
  const [d, setD] = useState(v);
  useEffect(() => {
    const t = setTimeout(() => setD(v), 200);
    return () => clearTimeout(t);
  }, [v]);
  return d;
}

function Search({ value, onChange, placeholder }: { value: string; onChange: (v: string) => void; placeholder: string }) {
  return <input className={`${inputCls} mb-4 max-w-sm`} placeholder={placeholder} value={value} onChange={(e) => onChange(e.target.value)} />;
}

function Overview() {
  const { data } = api.admin.stats.useQuery();
  const tiles: [string, string | number | undefined][] = [
    ["People", data?.users],
    ["Active (7 days)", data?.activeUsers7d],
    ["Imported, not yet joined", data?.ghosts],
    ["Workspaces", data?.workspaces],
    ["Boards", data?.boards],
    ["Cards", data?.cards],
    ["Comments", data?.comments],
    ["Uploaded files", data ? `${data.uploads} · ${(data.uploadBytes / 1024 / 1024).toFixed(1)} MB` : undefined],
    ["Trello imports", data?.imports],
  ];
  return (
    <div className="grid grid-cols-2 gap-3 md:grid-cols-3">
      {tiles.map(([label, value]) => (
        <div key={label} className="rounded-lg bg-[var(--color-surface)] p-4 shadow-[var(--shadow-card)]">
          <div className="text-xs font-semibold text-[var(--color-text-subtle)]">{label}</div>
          <div className="mt-1 text-2xl font-semibold tabular-nums">{value ?? "–"}</div>
        </div>
      ))}
    </div>
  );
}

function Users({ meId }: { meId: string }) {
  const [q, setQ] = useState("");
  const dq = useDebounced(q);
  const utils = api.useUtils();
  const { data } = api.admin.users.useQuery({ q: dq });
  const inv = () => utils.admin.users.invalidate();
  const setAdmin = api.admin.setAdmin.useMutation({ onSuccess: inv });
  const setCanImport = api.admin.setCanImport.useMutation({ onSuccess: inv });
  const revoke = api.admin.revokeSessions.useMutation();
  const del = api.admin.deleteUser.useMutation({ onSuccess: inv });
  const [confirm, setConfirm] = useState<string | null>(null);
  const err = setAdmin.error ?? setCanImport.error ?? del.error;
  return (
    <div>
      <Search value={q} onChange={setQ} placeholder="Search by name or email" />
      {err && <p className="mb-2 text-sm text-[var(--color-danger)]">{err.message}</p>}
      {revoke.isSuccess && <p className="mb-2 text-sm text-[var(--color-success)]">Signed out of {revoke.data.count} session(s).</p>}
      {data?.map((u) => (
        <div key={u.id} className="flex items-center gap-3 border-b border-[var(--color-border)] py-2.5">
          <Avatar user={u} size={36} />
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-1.5 truncate text-sm font-medium">
              {u.name ?? "(no name)"}
              {u.isAdmin && <span className="rounded bg-[var(--color-brand)] px-1.5 text-[11px] text-[var(--color-on-brand)]">ADMIN</span>}
              {u.canImport && !u.isAdmin && <span className="rounded bg-[var(--color-neutral-bold)] px-1.5 text-[11px]">IMPORTER</span>}
              {u.isGhost && <span className="rounded bg-[var(--color-neutral-bold)] px-1.5 text-[11px]">{u.invitedEmail ? "INVITED" : "IMPORTED"}</span>}
              {u.id === meId && <span className="text-xs text-[var(--color-text-subtlest)]">(you)</span>}
            </div>
            <div className="truncate text-xs text-[var(--color-text-subtlest)]">
              {u.email ?? "no email"} · {u._count.workspaces} workspaces · {u._count.boards} boards · joined{" "}
              {formatDistanceToNow(u.createdAt, { addSuffix: true })}
            </div>
          </div>
          {!u.isGhost && (
            <Button onClick={() => setAdmin.mutate({ userId: u.id, isAdmin: !u.isAdmin })} disabled={u.id === meId}>
              {u.isAdmin ? "Remove admin" : "Make admin"}
            </Button>
          )}
          {!u.isGhost && !u.isAdmin && (
            <Button onClick={() => setCanImport.mutate({ userId: u.id, canImport: !u.canImport })} title="Let this person import boards from Trello">
              {u.canImport ? "Remove import" : "Allow import"}
            </Button>
          )}
          {!u.isGhost && u.id !== meId && <Button onClick={() => revoke.mutate({ userId: u.id })}>Sign out</Button>}
          {u.id !== meId &&
            (confirm === u.id ? (
              <Button variant="danger" onClick={() => del.mutate({ userId: u.id })} onBlur={() => setConfirm(null)}>
                Delete + all their comments?
              </Button>
            ) : (
              <Button variant="subtle" onClick={() => setConfirm(u.id)} aria-label="Delete user">
                <Icon name="trash" size={14} />
              </Button>
            ))}
        </div>
      ))}
    </div>
  );
}

function Boards() {
  const [q, setQ] = useState("");
  const dq = useDebounced(q);
  const utils = api.useUtils();
  const { data } = api.admin.boards.useQuery({ q: dq });
  const join = api.admin.joinBoard.useMutation({ onSuccess: () => utils.admin.boards.invalidate() });
  const del = api.admin.deleteBoard.useMutation({ onSuccess: () => utils.admin.boards.invalidate() });
  const move = api.board.move.useMutation({ onSuccess: () => utils.admin.boards.invalidate() });
  const { data: workspaces } = api.admin.workspaces.useQuery({ q: "" });
  const [confirm, setConfirm] = useState<string | null>(null);
  return (
    <div>
      <Search value={q} onChange={setQ} placeholder="Search boards" />
      {data?.map((b) => {
        const mine = b.members[0]?.role;
        return (
          <div key={b.id} className="flex items-center gap-3 border-b border-[var(--color-border)] py-2.5">
            <span className="h-9 w-12 shrink-0 rounded-[3px]" style={boardBg(b)} />
            <div className="min-w-0 flex-1">
              <div className="truncate text-sm font-medium">
                {b.name} {b.closed && <span className="text-xs text-[var(--color-text-subtlest)]">(closed)</span>}
                {b.trelloId && <span className="ml-1 text-xs text-[var(--color-text-subtlest)]">· from Trello</span>}
              </div>
              <div className="truncate text-xs text-[var(--color-text-subtlest)]">
                {b.workspace.name} · {b.visibility} · {b._count.members} members · {b._count.lists} lists · updated{" "}
                {formatDistanceToNow(b.updatedAt, { addSuffix: true })}
              </div>
            </div>
            <select
              className="h-8 max-w-40 rounded-[3px] bg-[var(--color-neutral)] px-2 text-sm"
              value={b.workspace.id}
              onChange={(e) => move.mutate({ id: b.id, workspaceId: e.target.value })}
              title="Move to workspace"
              aria-label={`Move ${b.name} to workspace`}
            >
              {workspaces?.map((w) => (
                <option key={w.id} value={w.id}>{w.name}</option>
              ))}
            </select>
            {mine === "admin" ? (
              <Link href={`/b/${b.id}`}><Button>Open</Button></Link>
            ) : (
              <Button onClick={() => join.mutate({ boardId: b.id })}>Join as admin</Button>
            )}
            {confirm === b.id ? (
              <Button variant="danger" onClick={() => del.mutate({ boardId: b.id })} onBlur={() => setConfirm(null)}>Really delete?</Button>
            ) : (
              <Button variant="subtle" onClick={() => setConfirm(b.id)} aria-label="Delete board"><Icon name="trash" size={14} /></Button>
            )}
          </div>
        );
      })}
    </div>
  );
}

function Workspaces() {
  const [q, setQ] = useState("");
  const dq = useDebounced(q);
  const utils = api.useUtils();
  const { data } = api.admin.workspaces.useQuery({ q: dq });
  const join = api.admin.joinWorkspace.useMutation({
    onSuccess: () => {
      void utils.admin.workspaces.invalidate();
      void utils.workspace.list.invalidate();
    },
  });
  return (
    <div>
      <Search value={q} onChange={setQ} placeholder="Search workspaces" />
      {data?.map((w) => (
        <div key={w.id} className="flex items-center gap-3 border-b border-[var(--color-border)] py-2.5">
          <WorkspaceLogo ws={{ name: w.name, logo: w.logoKey ? `/api/workspaces/${w.id}/logo?v=${w.logoKey.slice(0, 8)}` : null }} size={36} />
          <div className="min-w-0 flex-1">
            <div className="truncate text-sm font-medium">{w.name}</div>
            <div className="text-xs text-[var(--color-text-subtlest)]">
              {w._count.members} members · {w._count.boards} boards · created {formatDistanceToNow(w.createdAt, { addSuffix: true })}
            </div>
          </div>
          {w.members[0]?.role === "admin" ? (
            <Link href={`/w/${w.id}`}><Button>Manage</Button></Link>
          ) : (
            <Button onClick={() => join.mutate({ workspaceId: w.id })}>Join as admin</Button>
          )}
        </div>
      ))}
    </div>
  );
}

function AutoJoin() {
  const utils = api.useUtils();
  const { data: rules } = api.admin.autoJoins.useQuery();
  const { data: workspaces } = api.admin.workspaces.useQuery({ q: "" });
  const [ws, setWs] = useState("");
  const [domain, setDomain] = useState("");
  const [role, setRole] = useState<"normal" | "admin">("normal");
  const [result, setResult] = useState<string | null>(null);
  const add = api.admin.addAutoJoin.useMutation({
    onSuccess: ({ rule, added }) => {
      void utils.admin.autoJoins.invalidate();
      setDomain("");
      setResult(`@${rule.domain} now auto-joins.${added ? ` Added ${added} existing ${added === 1 ? "person" : "people"}.` : ""}`);
    },
  });
  const remove = api.admin.removeAutoJoin.useMutation({ onSuccess: () => utils.admin.autoJoins.invalidate() });
  const wsId = (ws !== "" ? ws : workspaces?.[0]?.id) ?? "";
  return (
    <div>
      <p className="mb-4 text-sm text-[var(--color-text-subtle)]">
        People who log in with a matching email are added to the workspace automatically. Removing a rule keeps existing members.
      </p>
      <form
        className="mb-6 flex flex-wrap items-center gap-2"
        onSubmit={(e) => {
          e.preventDefault();
          setResult(null);
          add.mutate({ workspaceId: wsId, domain, role });
        }}
      >
        <div className="relative w-56">
          <span className="pointer-events-none absolute top-1/2 left-3 -translate-y-1/2 text-[var(--color-text-subtlest)]">@</span>
          <input className={`${inputCls} pl-7`} value={domain} onChange={(e) => setDomain(e.target.value)} placeholder="hackclub.com" />
        </div>
        <span className="text-sm text-[var(--color-text-subtle)]">joins</span>
        <select className="h-9 max-w-56 rounded-[3px] bg-[var(--color-neutral)] px-2 text-sm" value={wsId} onChange={(e) => setWs(e.target.value)}>
          {workspaces?.map((w) => <option key={w.id} value={w.id}>{w.name}</option>)}
        </select>
        <select className="h-9 rounded-[3px] bg-[var(--color-neutral)] px-2 text-sm" value={role} onChange={(e) => setRole(e.target.value as typeof role)}>
          <option value="normal">as Member</option>
          <option value="admin">as Admin</option>
        </select>
        <Button variant="primary" type="submit" disabled={!domain.trim() || !wsId || add.isPending}>
          {add.isPending ? "Adding…" : "Add rule"}
        </Button>
      </form>
      {result && <p className="mb-3 text-sm text-[var(--color-success)]">{result}</p>}
      {(add.error ?? remove.error) && <p className="mb-3 text-sm text-[var(--color-danger)]">{(add.error ?? remove.error)!.message}</p>}
      {rules?.length === 0 && <p className="text-sm text-[var(--color-text-subtle)]">No auto-join rules yet.</p>}
      {rules?.map((r) => (
        <div key={r.id} className="flex items-center gap-3 border-b border-[var(--color-border)] py-2.5">
          <div className="min-w-0 flex-1">
            <div className="text-sm font-medium">
              @{r.domain} <span className="font-normal text-[var(--color-text-subtle)]">→</span> {r.workspace.name}
            </div>
            <div className="text-xs text-[var(--color-text-subtlest)]">
              as {r.role === "admin" ? "Admin" : "Member"} · {r.memberCount} current member{r.memberCount === 1 ? "" : "s"} from this domain
              {r.createdBy?.name ? ` · added by ${r.createdBy.name}` : ""}
            </div>
          </div>
          <Button onClick={() => remove.mutate({ ruleId: r.id })}>Remove</Button>
        </div>
      ))}
    </div>
  );
}

function Imports() {
  const { data } = api.admin.imports.useQuery();
  const [open, setOpen] = useState<string | null>(null);
  if (data?.length === 0) return <p className="text-sm text-[var(--color-text-subtle)]">No imports yet.</p>;
  return (
    <div>
      {data?.map((j) => (
        <div key={j.id} className="border-b border-[var(--color-border)] py-2.5">
          <button onClick={() => setOpen(open === j.id ? null : j.id)} className="flex w-full items-center gap-3 text-left">
            <span className={`h-2.5 w-2.5 rounded-full ${j.status === "done" ? "bg-[#1f845a]" : j.status === "error" ? "bg-[#c9372c]" : "bg-[#0c66e4]"}`} />
            <Avatar user={j.user} size={24} />
            <span className="flex-1 text-sm">
              <b>{j.user.name}</b> · {j.source === "api" ? "Trello API" : "JSON upload"} · {j.status}
            </span>
            <span className="text-xs text-[var(--color-text-subtlest)]">{formatDistanceToNow(j.createdAt, { addSuffix: true })}</span>
          </button>
          {open === j.id && (
            <pre className="mt-2 max-h-60 overflow-y-auto rounded-lg bg-[#172b4d] p-3 text-xs leading-5 text-[#dcdfe4]">{j.log.join("\n")}</pre>
          )}
        </div>
      ))}
    </div>
  );
}

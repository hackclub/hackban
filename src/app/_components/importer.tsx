"use client";

import Link from "next/link";
import { useEffect, useState } from "react";

import { api } from "~/trpc/react";

import { Avatar, Button, inputCls } from "./ui";

const CREDS_KEY = "hackban:trello-key";

export function Importer() {
  const [tab, setTab] = useState<"api" | "json">("api");
  const [jobId, setJobId] = useState<string | null>(null);
  return (
    <main className="mx-auto w-full max-w-[860px] px-4 py-10">
      <h1 className="mb-1 text-2xl font-semibold">Import from Trello</h1>
      <p className="mb-6 text-[var(--color-text-subtle)]">
        Bring your boards over with lists, cards, labels, checklists, comments, members, due dates, covers and attachments.
        Re-running an import updates boards in place rather than duplicating them.
      </p>
      {jobId ? (
        <JobView id={jobId} onReset={() => setJobId(null)} />
      ) : (
        <>
          <div className="mb-6 flex gap-1 border-b border-[var(--color-border)]">
            {(["api", "json"] as const).map((t) => (
              <button
                key={t}
                onClick={() => setTab(t)}
                className={`-mb-px border-b-2 px-3 py-2 text-sm font-medium ${tab === t ? "border-[var(--color-brand)] text-[var(--color-brand)]" : "border-transparent text-[var(--color-text-subtle)] hover:text-[var(--color-text)]"}`}
              >
                {t === "api" ? "Connect Trello account (recommended)" : "Upload JSON export"}
              </button>
            ))}
          </div>
          {tab === "api" ? <ApiImport onStart={setJobId} /> : <JsonImport onStart={setJobId} />}
        </>
      )}
      <Ghosts />
    </main>
  );
}

function WorkspaceSelect({ value, onChange, allowAuto }: { value: string | null; onChange: (v: string | null) => void; allowAuto: boolean }) {
  const { data } = api.workspace.list.useQuery();
  return (
    <select className={inputCls} value={value ?? ""} onChange={(e) => onChange(e.target.value || null)}>
      {allowAuto && <option value="">Match Trello workspaces (create as needed)</option>}
      {data?.map((w) => <option key={w.id} value={w.id}>Into: {w.name}</option>)}
    </select>
  );
}

function useCreds() {
  const [key, setKey] = useState("");
  const [token, setToken] = useState("");
  // The API key is not secret and is remembered for convenience; the token is never stored.
  useEffect(() => {
    try {
      setKey(localStorage.getItem(CREDS_KEY) ?? "");
    } catch {}
  }, []);
  useEffect(() => {
    try {
      if (key) localStorage.setItem(CREDS_KEY, key);
    } catch {}
  }, [key]);
  return { key, setKey, token, setToken, valid: key.length >= 10 && token.length >= 10 };
}

function CredFields({ c }: { c: ReturnType<typeof useCreds> }) {
  const authUrl = c.key
    ? `https://trello.com/1/authorize?expiration=1day&name=Hackban%20Import&scope=read&response_type=token&key=${encodeURIComponent(c.key)}`
    : null;
  return (
    <div className="space-y-3">
      <ol className="list-decimal space-y-1 pl-5 text-sm text-[var(--color-text-subtle)]">
        <li>
          Create a Power-Up at{" "}
          <a className="text-[var(--color-brand)] underline" href="https://trello.com/power-ups/admin" target="_blank" rel="noreferrer">trello.com/power-ups/admin</a>{" "}
          and generate an API key for it.
        </li>
        <li>Paste the key below, then click &ldquo;Authorize&rdquo; to get a read-only token (expires in a day).</li>
      </ol>
      <div>
        <label className="mb-1 block text-xs font-bold text-[var(--color-text-subtle)]">API key</label>
        <input className={inputCls} value={c.key} onChange={(e) => c.setKey(e.target.value.trim())} placeholder="32-character key" />
      </div>
      <div>
        <label className="mb-1 flex items-center justify-between text-xs font-bold text-[var(--color-text-subtle)]">
          Token
          {authUrl && <a className="font-normal text-[var(--color-brand)] underline" href={authUrl} target="_blank" rel="noreferrer">Authorize →</a>}
        </label>
        <input className={inputCls} type="password" value={c.token} onChange={(e) => c.setToken(e.target.value.trim())} placeholder="Token from the authorize page" />
      </div>
    </div>
  );
}

function ApiImport({ onStart }: { onStart: (id: string) => void }) {
  const c = useCreds();
  const list = api.import.trelloBoards.useMutation();
  const start = api.import.startApi.useMutation({ onSuccess: (j) => onStart(j.id) });
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [showClosed, setShowClosed] = useState(false);
  const [ws, setWs] = useState<string | null>(null);
  const boards = list.data?.boards.filter((b) => showClosed || !b.closed) ?? [];
  const orgName = new Map(list.data?.orgs.map((o) => [o.id, o.displayName]));
  const groups = new Map<string, typeof boards>();
  for (const b of boards) {
    const k = b.idOrganization ? orgName.get(b.idOrganization) ?? "Other workspace" : "Personal boards";
    groups.set(k, [...(groups.get(k) ?? []), b]);
  }

  return (
    <div>
      <CredFields c={c} />
      <Button className="mt-4" variant="primary" disabled={!c.valid || list.isPending} onClick={() => list.mutate({ key: c.key, token: c.token })}>
        {list.isPending ? "Connecting…" : list.data ? "Refresh boards" : "Connect"}
      </Button>
      {list.error && <p className="mt-2 text-sm text-[var(--color-danger)]">{list.error.message}</p>}

      {list.data && (
        <div className="mt-6">
          <div className="mb-3 flex items-center gap-3">
            <Avatar user={{ name: list.data.me.fullName, image: list.data.me.avatarUrl ? `${list.data.me.avatarUrl}/50.png` : null }} />
            <div className="flex-1 text-sm">
              Connected as <b>{list.data.me.fullName}</b> (@{list.data.me.username}). Your Trello identity will be linked to this account.
            </div>
          </div>
          <div className="mb-2 flex items-center gap-3 text-sm">
            <button className="text-[var(--color-brand)] underline" onClick={() => setSelected(new Set(boards.map((b) => b.id)))}>Select all</button>
            <button className="text-[var(--color-brand)] underline" onClick={() => setSelected(new Set())}>Select none</button>
            <label className="ml-auto flex items-center gap-1">
              <input type="checkbox" checked={showClosed} onChange={(e) => setShowClosed(e.target.checked)} /> Show closed boards
            </label>
          </div>
          {[...groups].map(([name, bs]) => (
            <div key={name} className="mb-4">
              <h3 className="mb-2 text-sm font-semibold">{name}</h3>
              <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
                {bs.map((b) => {
                  const on = selected.has(b.id);
                  return (
                    <button
                      key={b.id}
                      onClick={() => {
                        const s = new Set(selected);
                        if (on) s.delete(b.id);
                        else s.add(b.id);
                        setSelected(s);
                      }}
                      className={`relative h-20 overflow-hidden rounded-[3px] p-2 text-left text-sm font-bold text-white transition ${on ? "ring-4 ring-[var(--color-focus)]" : "opacity-80 hover:opacity-100"}`}
                      style={b.prefs.backgroundImage ? { backgroundImage: `url(${b.prefs.backgroundImage})`, backgroundSize: "cover" } : { background: b.prefs.backgroundColor ?? "#0079bf" }}
                    >
                      <span className="absolute inset-0 bg-black/25" />
                      <span className="relative">{b.name}{b.closed && " (closed)"}</span>
                      {on && <span className="absolute top-1 right-2 text-lg">✓</span>}
                    </button>
                  );
                })}
              </div>
            </div>
          ))}
          <div className="sticky bottom-0 mt-4 flex items-center gap-3 border-t border-[var(--color-border)] bg-[var(--color-surface)] py-3">
            <div className="w-80"><WorkspaceSelect value={ws} onChange={setWs} allowAuto /></div>
            <Button
              variant="primary"
              disabled={!selected.size || start.isPending}
              onClick={() => start.mutate({ key: c.key, token: c.token, boardIds: [...selected], workspaceId: ws })}
            >
              Import {selected.size} board{selected.size === 1 ? "" : "s"}
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}

function JsonImport({ onStart }: { onStart: (id: string) => void }) {
  const c = useCreds();
  const [files, setFiles] = useState<{ name: string; text: string }[]>([]);
  const [ws, setWs] = useState<string | null>(null);
  const [withCreds, setWithCreds] = useState(false);
  const start = api.import.startJson.useMutation({ onSuccess: (j) => onStart(j.id) });
  return (
    <div>
      <p className="mb-3 text-sm text-[var(--color-text-subtle)]">
        In Trello: board menu → <b>Print, export, and share</b> → <b>Export as JSON</b>. Drop one or more exported files here.
      </p>
      <label
        onDragOver={(e) => e.preventDefault()}
        onDrop={async (e) => {
          e.preventDefault();
          const list = [...e.dataTransfer.files];
          setFiles([...files, ...(await Promise.all(list.map(async (f) => ({ name: f.name, text: await f.text() }))))]);
        }}
        className="flex h-36 cursor-pointer flex-col items-center justify-center rounded-lg border-2 border-dashed border-[var(--color-border)] text-sm text-[var(--color-text-subtle)] hover:bg-[var(--color-neutral)]"
      >
        <input
          type="file"
          accept=".json,application/json"
          multiple
          hidden
          onChange={async (e) => {
            const list = [...(e.target.files ?? [])];
            setFiles([...files, ...(await Promise.all(list.map(async (f) => ({ name: f.name, text: await f.text() }))))]);
          }}
        />
        Drop JSON files here or click to choose
      </label>
      {files.map((f, i) => (
        <div key={i} className="mt-2 flex items-center justify-between rounded bg-[var(--color-neutral)] px-3 py-2 text-sm">
          {f.name} <span className="text-xs text-[var(--color-text-subtle)]">{(f.text.length / 1024).toFixed(0)} KB</span>
          <button className="text-[var(--color-danger)]" onClick={() => setFiles(files.filter((_, j) => j !== i))}>Remove</button>
        </div>
      ))}
      <label className="mt-4 flex items-center gap-2 text-sm">
        <input type="checkbox" checked={withCreds} onChange={(e) => setWithCreds(e.target.checked)} />
        Also download uploaded attachment files (needs a Trello API key + token; otherwise they stay as links to Trello)
      </label>
      {withCreds && <div className="mt-3"><CredFields c={c} /></div>}
      <div className="mt-4 flex items-center gap-3">
        <div className="w-80"><WorkspaceSelect value={ws} onChange={setWs} allowAuto={false} /></div>
        <Button
          variant="primary"
          disabled={!files.length || start.isPending || (withCreds && !c.valid)}
          onClick={() => start.mutate({ files: files.map((f) => f.text), workspaceId: ws, creds: withCreds ? { key: c.key, token: c.token } : undefined })}
        >
          Import {files.length || ""} file{files.length === 1 ? "" : "s"}
        </Button>
      </div>
      {start.error && <p className="mt-2 text-sm text-[var(--color-danger)]">{start.error.message}</p>}
    </div>
  );
}

function JobView({ id, onReset }: { id: string; onReset: () => void }) {
  const { data } = api.import.job.useQuery({ id }, { refetchInterval: (q) => (q.state.data && ["done", "error"].includes(q.state.data.status) ? false : 800) });
  const results = Array.isArray(data?.result) ? data.result : [];
  return (
    <div>
      <div className="mb-3 flex items-center gap-2">
        <span className={`h-2.5 w-2.5 rounded-full ${data?.status === "done" ? "bg-[#1f845a]" : data?.status === "error" ? "bg-[#c9372c]" : "animate-pulse bg-[#0c66e4]"}`} />
        <b className="capitalize">{data?.status ?? "starting"}</b>
      </div>
      <pre className="max-h-72 overflow-y-auto rounded-lg bg-[#172b4d] p-3 text-xs leading-5 text-[#dcdfe4]">{data?.log.join("\n")}</pre>
      {results.length > 0 && (
        <table className="mt-4 w-full text-sm">
          <thead>
            <tr className="text-left text-xs text-[var(--color-text-subtle)]">
              <th className="py-1">Board</th><th>Lists</th><th>Cards</th><th>Checklists</th><th>Comments</th><th>Attachments</th><th />
            </tr>
          </thead>
          <tbody>
            {results.map((r) => (
              <tr key={r.boardId} className="border-t border-[var(--color-border)]">
                <td className="py-2 font-medium">{r.board}</td>
                <td>{r.lists}</td><td>{r.cards}</td><td>{r.checklists} ({r.checkItems})</td><td>{r.comments}</td>
                <td>{r.attachments}{r.filesDownloaded ? ` (${r.filesDownloaded} files)` : ""}</td>
                <td><Link className="text-[var(--color-brand)] underline" href={`/b/${r.boardId}`}>Open</Link></td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
      {results.flatMap((r) => r.warnings).length > 0 && (
        <details className="mt-3 text-sm">
          <summary className="cursor-pointer text-[#946f00]">{results.flatMap((r) => r.warnings).length} warnings</summary>
          <ul className="mt-1 list-disc pl-5">{results.flatMap((r) => r.warnings).map((w, i) => <li key={i}>{w}</li>)}</ul>
        </details>
      )}
      {data && ["done", "error"].includes(data.status) && <Button className="mt-4" onClick={onReset}>Import more</Button>}
    </div>
  );
}

function Ghosts() {
  const utils = api.useUtils();
  const { data } = api.import.ghosts.useQuery();
  const claim = api.import.claimGhost.useMutation({ onSuccess: () => utils.import.ghosts.invalidate() });
  if (!data?.length) return null;
  return (
    <section className="mt-12">
      <h2 className="mb-1 text-lg font-semibold">Imported members</h2>
      <p className="mb-3 text-sm text-[var(--color-text-subtle)]">
        These Trello members haven&apos;t signed in to Hackban yet. Their cards and comments are kept under a placeholder. If one of them is you, claim it.
        Teammates can do the same after logging in.
      </p>
      {data.map((g) => (
        <div key={g.id} className="flex items-center gap-3 border-b border-[var(--color-border)] py-2">
          <Avatar user={g} />
          <span className="flex-1 text-sm">{g.name}</span>
          <Button onClick={() => claim.mutate({ ghostId: g.id })}>This is me</Button>
        </div>
      ))}
      {claim.error && <p className="text-sm text-[var(--color-danger)]">{claim.error.message}</p>}
    </section>
  );
}

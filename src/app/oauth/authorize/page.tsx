import { redirect } from "next/navigation";

import { Logo } from "~/app/_components/ui";
import { requireUser } from "~/server/auth/require";
import { db } from "~/server/db";
import { checkAuthorize, issue, knownRedirect, withParams } from "~/server/oauth";

type Params = Record<string, string | undefined>;
const FIELDS = ["client_id", "redirect_uri", "response_type", "code_challenge", "code_challenge_method", "state"] as const;

async function decide(form: FormData) {
  "use server";
  const user = await requireUser();
  const p: Params = {};
  for (const k of FIELDS) p[k] = (form.get(k) as string | null) ?? undefined;
  const check = await checkAuthorize(db, p);
  if ("error" in check || !check.ok) throw new Error("Invalid authorization request");
  if (form.get("allow") !== "1") redirect(withParams(check.redirectUri, { error: "access_denied", state: p.state }));
  const code = await issue(db, "code", check.client.id, user.id, { redirectUri: check.redirectUri, challenge: p.code_challenge! });
  redirect(withParams(check.redirectUri, { code, state: p.state }));
}

export default async function AuthorizePage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const raw = await searchParams;
  const p: Params = Object.fromEntries(Object.entries(raw).map(([k, v]) => [k, Array.isArray(v) ? v[0] : v]));
  const check = await checkAuthorize(db, p);
  if ("error" in check) return <Shell title="Can't connect">{check.error}</Shell>;
  if (!check.ok) redirect(withParams(check.redirectUri, { error: "invalid_request", error_description: "PKCE (S256) is required", state: p.state }));
  const user = await requireUser(`/oauth/authorize?${new URLSearchParams(p as Record<string, string>)}`);
  const dest = new URL(check.redirectUri);
  const where = dest.host || dest.protocol.slice(0, -1);

  return (
    <Shell title={`Connect ${check.client.name} to Hackban?`}>
      <p className="mb-4">
        <b className="text-[var(--color-text)]">{check.client.name}</b> at <b className="text-[var(--color-text)]">{where}</b> will be able to act as{" "}
        <b className="text-[var(--color-text)]">{user.name ?? user.email}</b> on every board you can open:
      </p>
      {!knownRedirect(check.redirectUri) && (
        <p role="alert" className="mb-4 rounded-[3px] bg-[var(--color-neutral)] px-3 py-2 text-left text-[var(--color-danger)]">
          Hackban doesn&apos;t recognise <b>{where}</b>. Only allow this if you just started connecting this app yourself. Anyone can name an
          app &ldquo;Claude&rdquo;.
        </p>
      )}
      <ul className="mb-4 list-disc space-y-1 pl-5 text-left">
        <li>Read your workspaces, boards, cards and comments</li>
        <li>Create and edit boards, lists, cards, checklists and comments</li>
      </ul>
      <p className="mb-6 text-xs text-[var(--color-text-subtlest)]">
        Revoke access any time in Settings → Connected apps.
      </p>
      <form action={decide} className="flex gap-2">
        {FIELDS.map((k) => p[k] !== undefined && <input key={k} type="hidden" name={k} value={p[k]} />)}
        <button name="allow" value="0" className="h-10 flex-1 rounded-[3px] bg-[var(--color-neutral)] font-semibold hover:bg-[var(--color-neutral-hover)]">
          Cancel
        </button>
        <button name="allow" value="1" className="h-10 flex-1 rounded-[3px] bg-[#ec3750] font-semibold text-white shadow-[0_1px_1px_#091e4240] transition-colors hover:bg-[#d62a42]">
          Allow
        </button>
      </form>
    </Shell>
  );
}

function Shell({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <main className="flex min-h-full flex-col items-center justify-center bg-[var(--color-modal)] px-4">
      <div className="w-full max-w-[440px] rounded-[3px] bg-[var(--color-surface)] px-10 py-8 text-center text-sm text-[var(--color-text-subtle)] shadow-[var(--shadow-overlay)]">
        <div className="mb-6 flex items-center justify-center gap-2 text-[28px] font-bold text-[var(--color-text)]">
          <Logo />
          Hackban
        </div>
        <h1 className="mb-4 text-base font-semibold text-[var(--color-text)]">{title}</h1>
        {children}
      </div>
    </main>
  );
}

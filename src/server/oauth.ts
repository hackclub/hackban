// OAuth 2.1 authorization server for MCP clients (Claude, Cursor, …).
// Public clients use PKCE; tokens are opaque and only their hashes are stored.
import { createHash, randomBytes, timingSafeEqual } from "node:crypto";

import { type db as Db } from "~/server/db";

type DB = typeof Db;
type Kind = "code" | "access" | "refresh";

const TTL: Record<Kind, number> = { code: 10 * 60, access: 60 * 60, refresh: 30 * 24 * 60 * 60 }; // seconds

export const sha256 = (s: string) => createHash("sha256").update(s).digest("hex");
export const newToken = () => `hb_${randomBytes(32).toString("base64url")}`;

/** Public origin of this request, honoring the reverse proxy (AUTH_TRUST_HOST is set in prod). */
export function baseUrl(h: Headers) {
  const host = (h.get("x-forwarded-host") ?? h.get("host") ?? "localhost:3000").split(",")[0]!.trim();
  const local = /^(localhost|127\.0\.0\.1|\[::1\])(:|$)/.test(host);
  return `${h.get("x-forwarded-proto")?.split(",")[0]?.trim() ?? (local ? "http" : "https")}://${host}`;
}

// Bearer tokens (no cookies), so any origin may call these endpoints.
export const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, DELETE, OPTIONS",
  "Access-Control-Allow-Headers": "Authorization, Content-Type, Mcp-Protocol-Version, Mcp-Session-Id, Last-Event-ID",
  "Access-Control-Expose-Headers": "WWW-Authenticate, Mcp-Session-Id",
};
export const preflight = () => new Response(null, { status: 204, headers: CORS });
export const json = (body: unknown, status = 200) =>
  Response.json(body, { status, headers: { ...CORS, "Cache-Control": "no-store" } });

/** PKCE S256: base64url(sha256(verifier)) must equal the challenge. */
export function verifyPkce(verifier: string, challenge: string) {
  const a = Buffer.from(createHash("sha256").update(verifier).digest("base64url"));
  const b = Buffer.from(challenge);
  return a.length === b.length && timingSafeEqual(a, b);
}

const LOOPBACK = ["localhost", "127.0.0.1", "[::1]"];

/** https, a native app's custom scheme, or http on loopback only (RFC 8252). */
export function validRedirectUri(u: string) {
  let url: URL;
  try {
    url = new URL(u);
  } catch {
    return false;
  }
  if (u.length > 2000 || url.hash) return false;
  if (url.protocol === "http:") return LOOPBACK.includes(url.hostname);
  return !["javascript:", "data:", "vbscript:", "file:", "blob:"].includes(url.protocol);
}

/** Exact match, except loopback http may use any port (RFC 8252 §7.3). */
export function redirectMatches(registered: string[], uri: string) {
  const anyPort = (u: string) => {
    if (!URL.canParse(u)) return u;
    const url = new URL(u);
    if (url.protocol === "http:" && LOOPBACK.includes(url.hostname)) url.port = "";
    return url.toString();
  };
  return registered.some((r) => r === uri || anyPort(r) === anyPort(uri));
}

/**
 * Custom schemes of Hackban's own native apps, the only redirects that get full-access
 * ("app") tokens. Any other custom scheme can hand the code to a website: a site can
 * register itself as the web+… handler, and microsoft-edge:https://… opens a page.
 */
const NATIVE_SCHEMES = ["hackban-desktop:"];

/**
 * Redirects that can only land in a client we recognise. Anyone can register an
 * app named "Claude", so the consent page warns unless the code goes back to one of these.
 * Hostnames only count over http(s): web+x://claude.ai/ goes to whichever site handles web+x.
 * Raycast's /redirect page only hands the code on to the Raycast app (hackban-raycast signs in through it).
 */
export function knownRedirect(uri: string) {
  const url = new URL(uri);
  if (["cursor:", "vscode:", ...NATIVE_SCHEMES].includes(url.protocol)) return true;
  if (url.protocol === "http:") return LOOPBACK.includes(url.hostname);
  if (url.protocol === "https:" && url.hostname === "raycast.com") return /^\/redirect(\/|$)/.test(url.pathname);
  return url.protocol === "https:" && [...LOOPBACK, "claude.ai", "claude.com", "vscode.dev"].includes(url.hostname);
}

/** Scopes a client can ask for. "app" is full access for native apps; anything else means MCP only. */
export type Scope = "mcp" | "app";

/** The granted scope for a space-separated `scope` request parameter. */
export function parseScope(raw: string | null | undefined): Scope {
  return (raw ?? "").split(/\s+/).includes("app") ? "app" : "mcp";
}

/**
 * Full-access ("app") tokens only go to Hackban's own native apps (NATIVE_SCHEMES).
 * A web page can't receive them, so a phishing site can't collect one with a consent
 * link. Loopback is left out too: that's where MCP clients listen.
 */
export function nativeRedirect(uri: string) {
  return URL.canParse(uri) && NATIVE_SCHEMES.includes(new URL(uri).protocol) && validRedirectUri(uri);
}

export function withParams(uri: string, params: Record<string, string | undefined>) {
  const url = new URL(uri);
  for (const [k, v] of Object.entries(params)) if (v) url.searchParams.set(k, v);
  return url.toString();
}

/**
 * Validate an authorization request. Until the client and redirect URI check
 * out, errors are shown on our page rather than redirected (no open redirects).
 */
export async function checkAuthorize(db: DB, p: Record<string, string | undefined>) {
  const client = p.client_id ? await db.oAuthClient.findUnique({ where: { id: p.client_id } }) : null;
  if (!client) return { error: "This app isn't registered with Hackban. Try connecting again from the app." } as const;
  const redirectUri = p.redirect_uri ?? (client.redirectUris.length === 1 ? client.redirectUris[0] : undefined);
  if (!redirectUri || !redirectMatches(client.redirectUris, redirectUri)) {
    return { error: "This app's redirect address doesn't match what it registered." } as const;
  }
  // Anyone else asking for "app" (e.g. an MCP client requesting every scope in our
  // metadata) gets "mcp": OAuth allows a narrower grant, and the token response says which.
  const scope: Scope = parseScope(p.scope) === "app" && nativeRedirect(redirectUri) ? "app" : "mcp";
  const ok = p.response_type === "code" && !!p.code_challenge && p.code_challenge_method === "S256";
  return { client, redirectUri, scope, ok } as const;
}

export async function issue(
  db: DB,
  kind: Kind,
  clientId: string,
  userId: string,
  extra?: { redirectUri?: string; challenge?: string; scope?: string | null },
) {
  const token = newToken();
  await db.oAuthToken.create({
    data: { hash: sha256(token), kind, clientId, userId, expiresAt: new Date(Date.now() + TTL[kind] * 1000), ...extra },
  });
  return token;
}

/** Token endpoint response: a fresh access + (rotated) refresh token, keeping the grant's scope. */
export async function issueTokens(db: DB, clientId: string, userId: string, scope: string | null = null) {
  void db.oAuthToken.deleteMany({ where: { expiresAt: { lt: new Date() } } }).catch(() => undefined);
  const [access_token, refresh_token] = await Promise.all([
    issue(db, "access", clientId, userId, { scope }),
    issue(db, "refresh", clientId, userId, { scope }),
  ]);
  return { access_token, refresh_token, token_type: "Bearer", expires_in: TTL.access, scope: scope ?? "mcp" };
}

/** Single-use tokens (codes, refresh tokens): spent on first presentation, valid or not. */
export async function consume(db: DB, token: string, kind: "code" | "refresh") {
  const hash = sha256(token);
  const row = await db.oAuthToken.findUnique({ where: { hash } });
  if (!row) return null;
  // updateMany's count is the atomic claim: of two concurrent exchanges, only one wins.
  const { count } = await db.oAuthToken.updateMany({ where: { hash, usedAt: null }, data: { usedAt: new Date() } });
  if (count === 0) {
    // A spent token came back, so someone else holds a copy: revoke the whole grant (OAuth 2.1 §4.3.1).
    await db.oAuthToken.deleteMany({ where: { userId: row.userId, clientId: row.clientId } });
    return null;
  }
  return row.kind === kind && row.expiresAt > new Date() ? row : null;
}

/** client_secret_basic, client_secret_post, or a public client (none). */
export async function authClient(db: DB, form: URLSearchParams, authorization: string | null) {
  let id = form.get("client_id");
  let secret = form.get("client_secret");
  const basic = authorization?.match(/^Basic (.+)$/i)?.[1];
  if (basic) {
    const pair = Buffer.from(basic, "base64").toString();
    const i = pair.indexOf(":");
    try {
      if (i < 0) return null;
      id = decodeURIComponent(pair.slice(0, i));
      secret = decodeURIComponent(pair.slice(i + 1));
    } catch {
      return null;
    }
  }
  const client = id ? await db.oAuthClient.findUnique({ where: { id } }) : null;
  if (!client || (client.secretHash && (!secret || sha256(secret) !== client.secretHash))) return null;
  return client;
}

async function accessToken(db: DB, authorization: string | null) {
  const token = authorization?.match(/^Bearer (.+)$/i)?.[1];
  if (!token) return null;
  const row = await db.oAuthToken.findUnique({ where: { hash: sha256(token) }, include: { user: true } });
  return row?.kind === "access" && row.expiresAt > new Date() ? row : null;
}

/** MCP: any access token. */
export async function userForBearer(db: DB, authorization: string | null) {
  return (await accessToken(db, authorization))?.user ?? null;
}

/**
 * Native apps: an "app"-scoped access token, as an Auth.js-shaped session.
 * Site-admin powers stay with the browser (as with MCP), so isAdmin is false.
 */
export async function appSessionForBearer(db: DB, authorization: string | null) {
  const row = await accessToken(db, authorization);
  if (row?.scope !== "app") return null;
  const { id, name, email, image } = row.user;
  return { user: { id, name, email, image, isAdmin: false }, expires: row.expiresAt.toISOString() };
}

import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { test } from "bun:test";

import {
  baseUrl,
  checkAuthorize,
  consume,
  knownRedirect,
  nativeRedirect,
  parseScope,
  redirectMatches,
  sha256,
  verifyPkce,
  validRedirectUri,
  withParams,
} from "~/server/oauth";

test("PKCE S256", () => {
  const verifier = "dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk";
  // RFC 7636 appendix B
  assert.equal(verifyPkce(verifier, "E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM"), true);
  assert.equal(verifyPkce(verifier, createHash("sha256").update("other").digest("base64url")), false);
  assert.equal(verifyPkce(verifier, ""), false);
});

test("redirect URIs", () => {
  for (const ok of ["https://claude.ai/api/mcp/auth_callback", "http://localhost:6274/cb", "http://127.0.0.1:33418/", "cursor://anysphere.cursor-retrieval/oauth/callback"]) {
    assert.equal(validRedirectUri(ok), true, ok);
  }
  for (const bad of ["http://evil.com/cb", "javascript:alert(1)", "data:text/html,hi", "https://x.com/cb#frag", "not a url"]) {
    assert.equal(validRedirectUri(bad), false, bad);
  }
});

test("params and base URL", () => {
  assert.equal(withParams("https://a.com/cb?x=1", { code: "c", state: undefined }), "https://a.com/cb?x=1&code=c");
  assert.equal(baseUrl(new Headers({ host: "localhost:3000" })), "http://localhost:3000");
  assert.equal(baseUrl(new Headers({ host: "internal:3000", "x-forwarded-host": "hackban.hackclub.com", "x-forwarded-proto": "https" })), "https://hackban.hackclub.com");
});

test("loopback redirects match on any port; others exactly", () => {
  assert.equal(redirectMatches(["http://localhost:1234/callback"], "http://localhost:5678/callback"), true);
  assert.equal(redirectMatches(["http://localhost:1234/callback"], "http://localhost:5678/other"), false);
  assert.equal(redirectMatches(["https://claude.ai/cb"], "https://claude.ai:444/cb"), false);
  assert.equal(knownRedirect("https://claude.ai/api/mcp/auth_callback"), true);
  assert.equal(knownRedirect("https://claude.ai.evil.com/cb"), false);
});

test("a replayed refresh token revokes the whole grant", async () => {
  const rows = new Map<string, { hash: string; kind: string; userId: string; clientId: string; usedAt: Date | null; expiresAt: Date }>();
  const fake = {
    oAuthToken: {
      findUnique: async ({ where }: { where: { hash: string } }) => rows.get(where.hash) ?? null,
      updateMany: async ({ where }: { where: { hash: string } }) => {
        const r = rows.get(where.hash);
        if (!r || r.usedAt) return { count: 0 };
        r.usedAt = new Date();
        return { count: 1 };
      },
      deleteMany: async ({ where }: { where: { userId: string; clientId: string } }) => {
        for (const [h, r] of rows) if (r.userId === where.userId && r.clientId === where.clientId) rows.delete(h);
        return { count: 0 };
      },
    },
  } as unknown as Parameters<typeof consume>[0];
  const later = new Date(Date.now() + 60_000);
  rows.set(sha256("rt"), { hash: sha256("rt"), kind: "refresh", userId: "u", clientId: "c", usedAt: null, expiresAt: later });
  rows.set(sha256("at"), { hash: sha256("at"), kind: "access", userId: "u", clientId: "c", usedAt: null, expiresAt: later });
  assert.ok(await consume(fake, "rt", "refresh"));
  assert.equal(await consume(fake, "rt", "refresh"), null);
  assert.equal(rows.size, 0);
});

test("app scope is opt-in and only for native redirects", () => {
  assert.equal(parseScope(undefined), "mcp");
  assert.equal(parseScope(""), "mcp");
  assert.equal(parseScope("mcp"), "mcp");
  assert.equal(parseScope("app"), "app");
  assert.equal(parseScope("read app"), "app");
  assert.equal(parseScope("application"), "mcp");
  assert.equal(nativeRedirect("hackban-desktop://oauth/callback"), true);
  for (const bad of [
    "https://evil.com/cb",
    "https://claude.ai/cb",
    "http://evil.com/cb",
    // Loopback is where MCP clients listen.
    "http://127.0.0.1:5000/cb",
    "http://localhost/cb",
    // Custom schemes that hand the URL to a website.
    "web+hb://claude.ai/cb",
    "microsoft-edge:https://evil.com/cb",
    "x-safari-https://evil.com/cb",
    "irc://evil.com/cb",
    "cursor://anysphere.cursor-retrieval/oauth/callback",
    "hackban-desktop://oauth/callback#frag",
    "javascript:alert(1)",
    "not a url",
  ]) {
    assert.equal(nativeRedirect(bad), false, bad);
  }
});

test("known redirects match hostnames only over http(s)", () => {
  for (const ok of ["hackban-desktop://oauth/callback", "https://claude.ai/cb", "http://127.0.0.1:5000/cb", "vscode://cb"]) {
    assert.equal(knownRedirect(ok), true, ok);
  }
  for (const bad of ["web+hb://claude.ai/cb", "irc://claude.ai/cb", "http://claude.ai/cb", "x-safari-https://vscode.dev/cb"]) {
    assert.equal(knownRedirect(bad), false, bad);
  }
});

test("asking for app with a non-native redirect is granted mcp, not an error", async () => {
  const redirectUris = ["https://vscode.dev/redirect", "http://127.0.0.1/cb", "hackban-desktop://oauth/callback"];
  const fake = {
    oAuthClient: { findUnique: async () => ({ id: "c", name: "App", redirectUris, secretHash: null, createdAt: new Date() }) },
  } as unknown as Parameters<typeof checkAuthorize>[0];
  const granted = async (redirect_uri: string, scope?: string) => {
    const r = await checkAuthorize(fake, { client_id: "c", redirect_uri, scope, response_type: "code", code_challenge: "x", code_challenge_method: "S256" });
    assert.ok(!("error" in r), redirect_uri);
    assert.equal(r.ok, true);
    return r.scope;
  };
  assert.equal(await granted("https://vscode.dev/redirect", "mcp app"), "mcp");
  assert.equal(await granted("http://127.0.0.1:4000/cb", "mcp app"), "mcp");
  assert.equal(await granted("hackban-desktop://oauth/callback", "app"), "app");
  assert.equal(await granted("hackban-desktop://oauth/callback"), "mcp");
});

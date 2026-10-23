import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { test } from "bun:test";

import { baseUrl, consume, knownRedirect, redirectMatches, sha256, verifyPkce, validRedirectUri, withParams } from "~/server/oauth";

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

import { db } from "~/server/db";
import { authClient, consume, issueTokens, json, preflight, verifyPkce } from "~/server/oauth";

export async function POST(req: Request) {
  const form = new URLSearchParams(await req.text());
  const client = await authClient(db, form, req.headers.get("authorization"));
  if (!client) return json({ error: "invalid_client" }, 401);

  if (form.get("grant_type") === "authorization_code") {
    const code = await consume(db, form.get("code") ?? "", "code");
    const verifier = form.get("code_verifier");
    if (
      code?.clientId !== client.id ||
      (form.get("redirect_uri") ?? code.redirectUri) !== code.redirectUri ||
      !verifier ||
      !verifyPkce(verifier, code.challenge ?? "")
    ) {
      return json({ error: "invalid_grant" }, 400);
    }
    return json(await issueTokens(db, client.id, code.userId));
  }

  if (form.get("grant_type") === "refresh_token") {
    const old = await consume(db, form.get("refresh_token") ?? "", "refresh");
    if (old?.clientId !== client.id) return json({ error: "invalid_grant" }, 400);
    return json(await issueTokens(db, client.id, old.userId));
  }

  return json({ error: "unsupported_grant_type" }, 400);
}

export const OPTIONS = preflight;

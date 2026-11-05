import { OAuthClientMetadataSchema } from "@modelcontextprotocol/sdk/shared/auth.js";

import { db } from "~/server/db";
import { json, newToken, preflight, sha256, validRedirectUri } from "~/server/oauth";

/** RFC 7591 dynamic client registration (MCP clients register themselves). */
export async function POST(req: Request) {
  const body = await req.text();
  if (body.length > 16_384) return json({ error: "invalid_client_metadata", error_description: "Too large" }, 413);
  // Registration is open, so sweep apps nobody ever finished connecting. Connected ones stay even with no
  // live grant: MCP clients cache their client_id and can't recover if it disappears.
  void db.oAuthClient
    .deleteMany({ where: { createdAt: { lt: new Date(Date.now() - 86_400_000) }, connectedAt: null, tokens: { none: {} } } })
    .catch(() => undefined);
  let input: unknown = null;
  try {
    input = JSON.parse(body);
  } catch {}
  const parsed = OAuthClientMetadataSchema.safeParse(input);
  if (!parsed.success) return json({ error: "invalid_client_metadata", error_description: parsed.error.message }, 400);
  const meta = parsed.data;
  if (meta.redirect_uris.length > 10 || !meta.redirect_uris.every(validRedirectUri)) {
    return json({ error: "invalid_redirect_uri", error_description: "Use https, a custom scheme, or http on localhost." }, 400);
  }
  // RFC 7591's default is client_secret_basic; most MCP clients ask for "none".
  const method = meta.token_endpoint_auth_method ?? "client_secret_basic";
  if (!["none", "client_secret_post", "client_secret_basic"].includes(method)) {
    return json({ error: "invalid_client_metadata", error_description: `Unsupported auth method ${method}` }, 400);
  }
  const secret = method === "none" ? null : newToken();
  const client = await db.oAuthClient.create({
    data: { name: (meta.client_name ?? "Unnamed app").slice(0, 100), redirectUris: meta.redirect_uris, secretHash: secret && sha256(secret) },
  });
  return json(
    {
      ...meta,
      client_id: client.id,
      client_id_issued_at: Math.floor(client.createdAt.getTime() / 1000),
      token_endpoint_auth_method: method,
      ...(secret && { client_secret: secret, client_secret_expires_at: 0 }),
    },
    201,
  );
}

export const OPTIONS = preflight;

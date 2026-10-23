import { baseUrl, json, preflight } from "~/server/oauth";

/** RFC 8414 metadata, served at /.well-known/oauth-authorization-server (see next.config.js). */
export function GET(req: Request) {
  const base = baseUrl(req.headers);
  return json({
    issuer: base,
    authorization_endpoint: `${base}/oauth/authorize`,
    token_endpoint: `${base}/api/oauth/token`,
    registration_endpoint: `${base}/api/oauth/register`,
    response_types_supported: ["code"],
    grant_types_supported: ["authorization_code", "refresh_token"],
    code_challenge_methods_supported: ["S256"],
    token_endpoint_auth_methods_supported: ["none", "client_secret_post", "client_secret_basic"],
  });
}

export const OPTIONS = preflight;

import { baseUrl, json, preflight } from "~/server/oauth";

/** RFC 9728 metadata at /.well-known/oauth-protected-resource: where to log in for /api/mcp. */
export function GET(req: Request) {
  const base = baseUrl(req.headers);
  return json({
    resource: `${base}/api/mcp`,
    resource_name: "Hackban",
    authorization_servers: [base],
    bearer_methods_supported: ["header"],
  });
}

export const OPTIONS = preflight;

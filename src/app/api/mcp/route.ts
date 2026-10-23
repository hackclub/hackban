import { WebStandardStreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js";

import { db } from "~/server/db";
import { hackbanMcp } from "~/server/mcp";
import { baseUrl, CORS, preflight, userForBearer } from "~/server/oauth";

// POST only: stateless mode has nothing to push on a GET stream, and Next answers 405 for it.
export async function POST(req: Request) {
  const base = baseUrl(req.headers);
  const user = await userForBearer(db, req.headers.get("authorization"));
  if (!user) {
    return Response.json(
      { error: "invalid_token" },
      {
        status: 401,
        headers: { ...CORS, "WWW-Authenticate": `Bearer resource_metadata="${base}/.well-known/oauth-protected-resource/api/mcp"` },
      },
    );
  }
  // Stateless: a fresh server per request, nothing held between calls.
  const transport = new WebStandardStreamableHTTPServerTransport({ sessionIdGenerator: undefined, enableJsonResponse: true });
  await hackbanMcp(user, base).connect(transport);
  const res = await transport.handleRequest(req);
  for (const [k, v] of Object.entries(CORS)) res.headers.set(k, v);
  return res;
}

export const OPTIONS = preflight;

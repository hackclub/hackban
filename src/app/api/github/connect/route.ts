import { randomBytes } from "node:crypto";

import { env } from "~/env";
import { auth } from "~/server/auth";
import { STATE_COOKIE } from "~/server/github";
import { baseUrl } from "~/server/oauth";

/** Send the signed-in user to GitHub to connect their account (see /api/github/callback). */
export async function GET(req: Request) {
  if (!env.GITHUB_CLIENT_ID || !env.GITHUB_CLIENT_SECRET) return new Response("GitHub sign-in isn't configured", { status: 404 });
  const session = await auth();
  if (!session?.user) return Response.redirect(`${baseUrl(req.headers)}/api/auth/signin`, 302);
  const state = randomBytes(16).toString("base64url");
  const params = new URLSearchParams({
    client_id: env.GITHUB_CLIENT_ID,
    redirect_uri: `${baseUrl(req.headers)}/api/github/callback`,
    // `repo` is the only OAuth-app scope that reads private issues (there's no read-only one).
    scope: "repo",
    state,
  });
  return new Response(null, {
    status: 302,
    headers: {
      Location: `https://github.com/login/oauth/authorize?${params}`,
      "Set-Cookie": `${STATE_COOKIE}=${state}; Path=/api/github; HttpOnly; SameSite=Lax; Max-Age=600${baseUrl(req.headers).startsWith("https") ? "; Secure" : ""}`,
    },
  });
}

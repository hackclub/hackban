import { env } from "~/env";
import { auth } from "~/server/auth";
import { db } from "~/server/db";
import { STATE_COOKIE } from "~/server/github";
import { baseUrl } from "~/server/oauth";

/** GitHub sends the user back here; swap the code for a token and remember it on their account. */
export async function GET(req: Request) {
  const base = baseUrl(req.headers);
  // Built by hand: Response.redirect() has immutable headers on Node, so the cookie couldn't be cleared.
  const back = (q: string) =>
    new Response(null, { status: 302, headers: { Location: `${base}/me?github=${q}`, "Set-Cookie": `${STATE_COOKIE}=; Path=/api/github; HttpOnly; Max-Age=0` } });
  if (!env.GITHUB_CLIENT_ID || !env.GITHUB_CLIENT_SECRET) return new Response("GitHub sign-in isn't configured", { status: 404 });
  const session = await auth();
  if (!session?.user) return Response.redirect(`${base}/api/auth/signin`, 302);
  const url = new URL(req.url);
  const cookieState = new RegExp(`(?:^|;\\s*)${STATE_COOKIE}=([^;]+)`).exec(req.headers.get("cookie") ?? "")?.[1];
  const code = url.searchParams.get("code");
  if (!code || !cookieState || url.searchParams.get("state") !== cookieState) return back("error");

  let token: { access_token?: string; scope?: string; error?: string };
  let gh: { login?: string };
  try {
    const tokenRes = await fetch("https://github.com/login/oauth/access_token", {
      method: "POST",
      headers: { Accept: "application/json", "Content-Type": "application/json" },
      body: JSON.stringify({ client_id: env.GITHUB_CLIENT_ID, client_secret: env.GITHUB_CLIENT_SECRET, code, redirect_uri: `${base}/api/github/callback` }),
    });
    token = (await tokenRes.json()) as typeof token;
    if (!token.access_token) throw new Error(token.error ?? `token endpoint responded ${tokenRes.status}`);
    const userRes = await fetch("https://api.github.com/user", {
      headers: { Authorization: `Bearer ${token.access_token}`, Accept: "application/vnd.github+json", "User-Agent": "hackban" },
    });
    gh = (await userRes.json()) as typeof gh;
    if (!gh.login) throw new Error(`user endpoint responded ${userRes.status}`);
  } catch (e) {
    console.error("[github] connect failed:", (e as Error).message);
    return back("error");
  }

  await db.gitHubConnection.upsert({
    where: { userId: session.user.id },
    update: { login: gh.login, accessToken: token.access_token, scope: token.scope ?? "" },
    create: { userId: session.user.id, login: gh.login, accessToken: token.access_token, scope: token.scope ?? "" },
  });
  // Re-check issues this user added that couldn't be read before.
  await db.gitHubIssue.updateMany({ where: { addedById: session.user.id, fetchError: { not: null } }, data: { checkedAt: null } });
  return back("connected");
}

import { auth } from "~/server/auth";
import { db } from "~/server/db";
import { appSessionForBearer } from "~/server/oauth";

/** Session for a plain API route: the browser's cookie, or a native app's "app"-scoped bearer token. */
export async function sessionFor(req: Request) {
  return (await auth()) ?? (await appSessionForBearer(db, req.headers.get("authorization")));
}

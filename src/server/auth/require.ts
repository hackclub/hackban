import { redirect } from "next/navigation";

import { auth } from "~/server/auth";

export async function requireUser(callbackUrl = "/") {
  const session = await auth();
  if (!session?.user) redirect(`/login?callbackUrl=${encodeURIComponent(callbackUrl)}`);
  return session.user;
}

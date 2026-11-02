/** Runs once when the server starts: background jobs live here. */
export async function register() {
  if (process.env.NEXT_RUNTIME !== "nodejs") return;
  const [{ db }, { startIssuePoller }] = await Promise.all([import("~/server/db"), import("~/server/github")]);
  startIssuePoller(db);
}

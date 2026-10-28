import { env } from "~/env";
import { db } from "~/server/db";

const HACKBAN_CHANNEL = "C0CBMNBCN2C";

/** Invite a user to #hackban the first time they log in. No-op without SLACK_BOT_TOKEN. */
export async function joinHackbanChannel(userId: string, slackId: string) {
  if (!env.SLACK_BOT_TOKEN) return;
  const user = await db.user.findUnique({ where: { id: userId }, select: { slackJoined: true } });
  if (!user || user.slackJoined) return;
  const res = await fetch("https://slack.com/api/conversations.invite", {
    method: "POST",
    headers: { Authorization: `Bearer ${env.SLACK_BOT_TOKEN}`, "Content-Type": "application/json; charset=utf-8" },
    body: JSON.stringify({ channel: HACKBAN_CHANNEL, users: slackId }),
  });
  const data = (await res.json()) as { ok: boolean; error?: string };
  if (data.ok || data.error === "already_in_channel") {
    await db.user.update({ where: { id: userId }, data: { slackJoined: true } });
  } else {
    console.error(`[slack] invite ${slackId} to #hackban failed: ${data.error}`);
  }
}

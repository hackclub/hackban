import { PrismaAdapter } from "@auth/prisma-adapter";
import { type DefaultSession, type NextAuthConfig } from "next-auth";

import { env } from "~/env";
import { applyAutoJoinForUser, claimInvite } from "~/server/autojoin";
import { db } from "~/server/db";
import { joinHackbanChannel } from "~/server/slack";

declare module "next-auth" {
  interface Session extends DefaultSession {
    user: {
      id: string;
      isAdmin: boolean;
    } & DefaultSession["user"];
  }
}

// Shape of GET https://auth.hackclub.com/api/v1/me
export function adminEmails() {
  return new Set(
    env.ADMIN_EMAILS.split(",")
      .map((e) => e.trim().toLowerCase())
      .filter(Boolean),
  );
}

type HackClubProfile = {
  identity: {
    id: string;
    primary_email?: string;
    first_name?: string;
    last_name?: string;
    slack_id?: string;
  };
};

export const authConfig = {
  providers: [
    {
      id: "hackclub",
      name: "Hack Club",
      // Plain OAuth 2: the app isn't granted the `openid` scope, so there's no
      // ID token; the profile comes from the identity API instead.
      type: "oauth",
      clientId: env.AUTH_HACKCLUB_ID,
      clientSecret: env.AUTH_HACKCLUB_SECRET,
      authorization: {
        url: "https://auth.hackclub.com/oauth/authorize",
        params: { scope: env.AUTH_HACKCLUB_SCOPE },
      },
      token: "https://auth.hackclub.com/oauth/token",
      userinfo: "https://auth.hackclub.com/api/v1/me",
      checks: ["pkce", "state"],
      profile({ identity: p }: HackClubProfile) {
        const full = [p.first_name, p.last_name].filter(Boolean).join(" ");
        return {
          id: p.id,
          name: full !== "" ? full : (p.primary_email ?? null),
          email: p.primary_email ?? null,
          image: p.slack_id ? `https://cachet.dunkirk.sh/users/${p.slack_id}/r` : null,
        };
      },
    },
  ],
  adapter: PrismaAdapter(db),
  pages: { signIn: "/login" },
  events: {
    async signIn({ user, profile }) {
      if (user.id) {
        // Fire and forget: a slow or failing Slack API must not block login.
        const slackId = (profile as HackClubProfile | undefined)?.identity?.slack_id;
        if (slackId) void joinHackbanChannel(user.id, slackId).catch((e) => console.error("[slack]", e));
        await db.user.updateMany({
          where: { id: user.id, isGhost: true },
          data: { isGhost: false },
        });
        // Boards and workspaces they were invited to by email.
        await claimInvite(user.id, user.email);
        // Domain auto-join rules (e.g. everyone @hackclub.com joins Hack Club).
        await applyAutoJoinForUser(user.id, user.email);
        // Only ever grants: admins promoted in /admin must keep it across logins.
        // To demote a former ADMIN_EMAILS admin, drop them from the env, then use /admin.
        if (user.email && adminEmails().has(user.email.toLowerCase())) await db.user.update({ where: { id: user.id }, data: { isAdmin: true } });
      }
    },
  },
  callbacks: {
    session: ({ session, user }) => ({
      ...session,
      user: { ...session.user, id: user.id, isAdmin: (user as { isAdmin?: boolean }).isAdmin ?? false },
    }),
  },
} satisfies NextAuthConfig;

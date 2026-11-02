import { createEnv } from "@t3-oss/env-nextjs";
import { z } from "zod";

export const env = createEnv({
  /**
   * Specify your server-side environment variables schema here. This way you can ensure the app
   * isn't built with invalid env vars.
   */
  server: {
    AUTH_SECRET:
      process.env.NODE_ENV === "production"
        ? z.string()
        : z.string().optional(),
    AUTH_HACKCLUB_ID: z.string(),
    AUTH_HACKCLUB_SECRET: z.string(),
    UPLOAD_DIR: z.string().default("./uploads"),
    // Comma-separated emails that are always site admins.
    ADMIN_EMAILS: z.string().default(""),
    // Must be a subset of the scopes enabled on the Hack Club Auth app.
    AUTH_HACKCLUB_SCOPE: z.string().default("email name slack_id"),
    // Bot token (channels:manage) that adds new users to #hackban. Optional.
    SLACK_BOT_TOKEN: z.string().optional(),
    // Raises the GitHub API rate limit for tracked issues (any token with public repo read works). Optional.
    GITHUB_TOKEN: z.string().optional(),
    // GitHub OAuth app that lets users connect their own account (for issues in private repos). Optional.
    GITHUB_CLIENT_ID: z.string().optional(),
    GITHUB_CLIENT_SECRET: z.string().optional(),
    // Shared secret of a GitHub "issues" webhook pointed at /api/github/webhook. Optional; polling works without it.
    GITHUB_WEBHOOK_SECRET: z.string().optional(),
    DATABASE_URL: z.string().url(),
    NODE_ENV: z
      .enum(["development", "test", "production"])
      .default("development"),
  },

  /**
   * Specify your client-side environment variables schema here. This way you can ensure the app
   * isn't built with invalid env vars. To expose them to the client, prefix them with
   * `NEXT_PUBLIC_`.
   */
  client: {
    // NEXT_PUBLIC_CLIENTVAR: z.string(),
  },

  /**
   * You can't destruct `process.env` as a regular object in the Next.js edge runtimes (e.g.
   * middlewares) or client-side so we need to destruct manually.
   */
  runtimeEnv: {
    AUTH_SECRET: process.env.AUTH_SECRET,
    AUTH_HACKCLUB_ID: process.env.AUTH_HACKCLUB_ID,
    AUTH_HACKCLUB_SECRET: process.env.AUTH_HACKCLUB_SECRET,
    UPLOAD_DIR: process.env.UPLOAD_DIR,
    ADMIN_EMAILS: process.env.ADMIN_EMAILS,
    AUTH_HACKCLUB_SCOPE: process.env.AUTH_HACKCLUB_SCOPE,
    SLACK_BOT_TOKEN: process.env.SLACK_BOT_TOKEN,
    GITHUB_TOKEN: process.env.GITHUB_TOKEN,
    GITHUB_CLIENT_ID: process.env.GITHUB_CLIENT_ID,
    GITHUB_CLIENT_SECRET: process.env.GITHUB_CLIENT_SECRET,
    GITHUB_WEBHOOK_SECRET: process.env.GITHUB_WEBHOOK_SECRET,
    DATABASE_URL: process.env.DATABASE_URL,
    NODE_ENV: process.env.NODE_ENV,
  },
  /**
   * Run `build` or `dev` with `SKIP_ENV_VALIDATION` to skip env validation. This is especially
   * useful for Docker builds.
   */
  skipValidation: !!process.env.SKIP_ENV_VALIDATION,
  /**
   * Makes it so that empty strings are treated as undefined. `SOME_VAR: z.string()` and
   * `SOME_VAR=''` will throw an error.
   */
  emptyStringAsUndefined: true,
});

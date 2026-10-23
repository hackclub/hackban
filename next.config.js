/**
 * Run `build` or `dev` with `SKIP_ENV_VALIDATION` to skip env validation. This is especially useful
 * for Docker builds.
 */
import { execSync } from "node:child_process";
import "./src/env.js";

// Docker builds have no .git, so fall back to the SOURCE_COMMIT build arg.
let commit = process.env.SOURCE_COMMIT ?? "";
try {
  commit ||= execSync("git rev-parse HEAD").toString().trim();
} catch {}

/** @type {import("next").NextConfig} */
const config = {
  // Self-contained server bundle for the Docker image.
  output: "standalone",
  env: { BUILD_COMMIT: commit, BUILD_TIME: new Date().toISOString() },
  // The OAuth consent page must never be framed (clickjacking an "Allow").
  headers: async () => [
    {
      source: "/oauth/:path*",
      headers: [
        { key: "Content-Security-Policy", value: "frame-ancestors 'none'" },
        { key: "X-Frame-Options", value: "DENY" },
      ],
    },
  ],
  // OAuth discovery for MCP clients, including path-suffixed lookups (…/api/mcp).
  rewrites: async () => [
    { source: "/.well-known/oauth-authorization-server/:path*", destination: "/api/oauth/metadata" },
    { source: "/.well-known/oauth-protected-resource/:path*", destination: "/api/oauth/resource" },
  ],
};

export default config;

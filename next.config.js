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
};

export default config;

import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

import { nanoid } from "nanoid";

import { env } from "~/env";

// Resolved lazily: during `next build` env validation (and its defaults) is
// skipped, so UPLOAD_DIR can be undefined at module load.
const root = () => path.resolve(env.UPLOAD_DIR ?? "./uploads");

export async function saveFile(data: Uint8Array) {
  const key = nanoid(24);
  await mkdir(root(), { recursive: true });
  await writeFile(path.join(root(), key), data);
  return key;
}

export function readStored(key: string) {
  if (!/^[\w-]+$/.test(key)) throw new Error("bad key");
  return readFile(path.join(root(), key));
}

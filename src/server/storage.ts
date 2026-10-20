import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

import { nanoid } from "nanoid";

import { env } from "~/env";

const root = path.resolve(env.UPLOAD_DIR);

export async function saveFile(data: Uint8Array) {
  const key = nanoid(24);
  await mkdir(root, { recursive: true });
  await writeFile(path.join(root, key), data);
  return key;
}

export function readStored(key: string) {
  if (!/^[\w-]+$/.test(key)) throw new Error("bad key");
  return readFile(path.join(root, key));
}

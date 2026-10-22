import { mkdir, readFile, unlink, writeFile } from "node:fs/promises";
import path from "node:path";

import { nanoid } from "nanoid";

import { type Prisma } from "../../generated/prisma";

import { env } from "~/env";
import { db } from "~/server/db";

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

/** Best-effort delete; a missing file is fine. */
export async function removeStored(key: string | null | undefined) {
  if (!key || !/^[\w-]+$/.test(key)) return;
  await unlink(path.join(root(), key)).catch(() => undefined);
}

/** Files of attachments matching `where`; call before a cascading delete, remove after. */
export async function storedKeys(where: Prisma.AttachmentWhereInput) {
  const rows = await db.attachment.findMany({ where: { ...where, storageKey: { not: null } }, select: { storageKey: true } });
  return rows.map((r) => r.storageKey);
}

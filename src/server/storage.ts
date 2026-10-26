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

/** PNG/JPEG/GIF/WebP type read from the file's magic bytes (not the client's claim), or null. */
export function imageType(b: Uint8Array) {
  const ascii = (from: number, to: number) => String.fromCharCode(...b.subarray(from, to));
  if (b[0] === 0x89 && ascii(1, 4) === "PNG") return "image/png";
  if (b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return "image/jpeg";
  if (ascii(0, 4) === "GIF8") return "image/gif";
  if (ascii(0, 4) === "RIFF" && ascii(8, 12) === "WEBP") return "image/webp";
  return null;
}

/** Best-effort delete; a missing file is fine. */
export async function removeStored(key: string | null | undefined) {
  if (!key || !/^[\w-]+$/.test(key)) return;
  // Copied cards share their attachments' files; keep it while any row still uses it.
  if (await db.attachment.count({ where: { storageKey: key } })) return;
  await unlink(path.join(root(), key)).catch(() => undefined);
}

/**
 * Whether a multipart body is too big to buffer. A missing length (chunked
 * upload) counts as too big: browsers always send one for FormData.
 */
export function bodyTooBig(req: Request, maxBytes: number) {
  const len = req.headers.get("content-length");
  return len === null || Number(len) > maxBytes + 64 * 1024; // multipart overhead is well under 64 KB
}

/** Files of attachments matching `where`; call before a cascading delete, remove after. */
export async function storedKeys(where: Prisma.AttachmentWhereInput) {
  const rows = await db.attachment.findMany({ where: { ...where, storageKey: { not: null } }, select: { storageKey: true } });
  return rows.map((r) => r.storageKey);
}

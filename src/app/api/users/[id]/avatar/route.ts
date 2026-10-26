import { auth } from "~/server/auth";
import { db } from "~/server/db";
import { imageType, readStored, removeStored, saveFile } from "~/server/storage";

const MAX_BYTES = 2 * 1024 * 1024;

/** Signed-in user's id if it matches the route's user (you can only change your own avatar). */
async function self(id: string) {
  const session = await auth();
  return session?.user.id === id ? id : null;
}

/** Swap the uploaded avatar (or drop it, restoring the Slack one), then delete the old file. */
async function replaceAvatar(id: string, key: string | null, type?: string) {
  const old = await db.user.findUniqueOrThrow({ where: { id }, select: { avatarKey: true, image: true, providerImage: true } });
  const original = old.avatarKey ? old.providerImage : old.image;
  await db.user.update({
    where: { id },
    data: key
      ? { avatarKey: `${key}:${type}`, image: `/api/users/${id}/avatar?v=${key}`, providerImage: original }
      : { avatarKey: null, image: original, providerImage: null },
  });
  await removeStored(old.avatarKey?.split(":")[0]);
}

/** Any signed-in user can see avatars; they show up on every shared board. */
export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!(await auth())?.user) return new Response("Not found", { status: 404 });
  const user = await db.user.findUnique({ where: { id }, select: { avatarKey: true } });
  if (!user?.avatarKey) return new Response("Not found", { status: 404 });
  const [key, type] = user.avatarKey.split(":") as [string, string];
  return new Response(new Uint8Array(await readStored(key)), {
    headers: {
      "Content-Type": type,
      // The URL carries a version param, so it can be cached forever.
      "Cache-Control": "private, max-age=31536000, immutable",
      "Content-Security-Policy": "default-src 'none'",
      "X-Content-Type-Options": "nosniff",
    },
  });
}

/** Upload your own avatar (multipart field "file"). */
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const id = await self((await params).id);
  if (!id) return new Response("Forbidden", { status: 403 });
  // Reject oversized bodies before buffering them; the multipart overhead is well under 64 KB.
  if (Number(req.headers.get("content-length") ?? 0) > MAX_BYTES + 64 * 1024) return new Response("Pictures must be under 2 MB.", { status: 413 });
  const file = (await req.formData()).get("file");
  if (!(file instanceof File)) return new Response("No file", { status: 400 });
  if (file.size > MAX_BYTES) return new Response("Pictures must be under 2 MB.", { status: 413 });
  const data = new Uint8Array(await file.arrayBuffer());
  const type = imageType(data);
  if (!type) return new Response("Use a PNG, JPEG, GIF or WebP image.", { status: 415 });
  await replaceAvatar(id, await saveFile(data), type);
  return new Response(null, { status: 204 });
}

export async function DELETE(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const id = await self((await params).id);
  if (!id) return new Response("Forbidden", { status: 403 });
  await replaceAvatar(id, null);
  return new Response(null, { status: 204 });
}

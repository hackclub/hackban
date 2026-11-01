import { sessionFor } from "~/server/auth/session";
import { db } from "~/server/db";
import { bodyTooBig, imageType, readStored, removeStored, saveFile } from "~/server/storage";

const MAX_BYTES = 2 * 1024 * 1024;

async function membership(req: Request, workspaceId: string) {
  const session = await sessionFor(req);
  if (!session?.user) return null;
  return db.workspaceMember.findUnique({ where: { workspaceId_userId: { workspaceId, userId: session.user.id } } });
}

/** Swap the logo, then delete the old file from disk. */
async function replaceLogo(id: string, logoKey: string | null) {
  const old = await db.workspace.findUnique({ where: { id }, select: { logoKey: true } });
  await db.workspace.update({ where: { id }, data: { logoKey } });
  await removeStored(old?.logoKey?.split(":")[0]);
}

export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!(await membership(req, id))) return new Response("Not found", { status: 404 });
  const ws = await db.workspace.findUnique({ where: { id }, select: { logoKey: true } });
  if (!ws?.logoKey) return new Response("Not found", { status: 404 });
  const [key, type] = ws.logoKey.split(":") as [string, string];
  return new Response(new Uint8Array(await readStored(key)), {
    headers: {
      "Content-Type": type,
      // The URL carries a version param, so it can be cached forever.
      "Cache-Control": "private, max-age=31536000, immutable",
      "X-Content-Type-Options": "nosniff",
    },
  });
}

/** Workspace admins upload a logo (multipart field "file"). */
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const m = await membership(req, id);
  if (m?.role !== "admin") return new Response("Forbidden", { status: 403 });
  if (bodyTooBig(req, MAX_BYTES)) return new Response("Logos must be under 2 MB.", { status: 413 });
  const file = (await req.formData()).get("file");
  if (!(file instanceof File)) return new Response("No file", { status: 400 });
  if (file.size > MAX_BYTES) return new Response("Logos must be under 2 MB.", { status: 413 });
  const data = new Uint8Array(await file.arrayBuffer());
  const type = imageType(data);
  if (!type) return new Response("Use a PNG, JPEG, GIF or WebP image.", { status: 415 });
  const key = await saveFile(data);
  await replaceLogo(id, `${key}:${type}`);
  return new Response(null, { status: 204 });
}

export async function DELETE(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const m = await membership(req, id);
  if (m?.role !== "admin") return new Response("Forbidden", { status: 403 });
  await replaceLogo(id, null);
  return new Response(null, { status: 204 });
}

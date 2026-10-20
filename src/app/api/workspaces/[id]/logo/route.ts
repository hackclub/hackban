import { auth } from "~/server/auth";
import { db } from "~/server/db";
import { readStored, saveFile } from "~/server/storage";

const MAX_BYTES = 2 * 1024 * 1024;
const TYPES = new Set(["image/png", "image/jpeg", "image/gif", "image/webp"]);

async function membership(workspaceId: string) {
  const session = await auth();
  if (!session?.user) return null;
  return db.workspaceMember.findUnique({ where: { workspaceId_userId: { workspaceId, userId: session.user.id } } });
}

export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!(await membership(id))) return new Response("Not found", { status: 404 });
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
  const m = await membership(id);
  if (m?.role !== "admin") return new Response("Forbidden", { status: 403 });
  const file = (await req.formData()).get("file");
  if (!(file instanceof File)) return new Response("No file", { status: 400 });
  if (!TYPES.has(file.type)) return new Response("Use a PNG, JPEG, GIF or WebP image.", { status: 415 });
  if (file.size > MAX_BYTES) return new Response("Logos must be under 2 MB.", { status: 413 });
  const key = await saveFile(new Uint8Array(await file.arrayBuffer()));
  await db.workspace.update({ where: { id }, data: { logoKey: `${key}:${file.type}` } });
  return new Response(null, { status: 204 });
}

export async function DELETE(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const m = await membership(id);
  if (m?.role !== "admin") return new Response("Forbidden", { status: 403 });
  await db.workspace.update({ where: { id }, data: { logoKey: null } });
  return new Response(null, { status: 204 });
}

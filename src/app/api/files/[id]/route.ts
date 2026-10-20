import { requireCard } from "~/server/api/access";
import { auth } from "~/server/auth";
import { db } from "~/server/db";
import { readStored } from "~/server/storage";

export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const session = await auth();
  if (!session?.user) return new Response("Unauthorized", { status: 401 });
  const { id } = await params;
  const a = await db.attachment.findUnique({ where: { id } });
  if (!a?.storageKey) return new Response("Not found", { status: 404 });
  try {
    await requireCard(db, session.user.id, a.cardId, false);
  } catch {
    return new Response("Forbidden", { status: 403 });
  }
  const data = await readStored(a.storageKey);
  const inline = !!a.mimeType?.startsWith("image/") || a.mimeType === "application/pdf";
  return new Response(new Uint8Array(data), {
    headers: {
      "Content-Type": a.mimeType ?? "application/octet-stream",
      "Content-Disposition": `${inline ? "inline" : "attachment"}; filename*=UTF-8''${encodeURIComponent(a.name)}`,
      "Cache-Control": "private, max-age=31536000, immutable",
      "X-Content-Type-Options": "nosniff",
    },
  });
}

import { requireCard } from "~/server/api/access";
import { sessionFor } from "~/server/auth/session";
import { db } from "~/server/db";
import { readStored } from "~/server/storage";

const INLINE_TYPES = new Set(["image/png", "image/jpeg", "image/gif", "image/webp", "image/avif", "application/pdf"]);

export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const session = await sessionFor(req);
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
  // The stored MIME type is client-supplied. Only render known-safe types
  // inline; anything else (e.g. image/svg+xml or text/html, which can run
  // script on our origin) is served as an opaque download.
  const inline = !!a.mimeType && INLINE_TYPES.has(a.mimeType);
  return new Response(new Uint8Array(data), {
    headers: {
      "Content-Type": inline ? a.mimeType! : "application/octet-stream",
      // sandbox blocks script even if a browser sniffs content; Chrome's PDF
      // viewer refuses to render under sandbox, so PDFs get the rest only.
      "Content-Security-Policy": `default-src 'none'; img-src 'self'; style-src 'unsafe-inline'${a.mimeType === "application/pdf" ? "" : "; sandbox"}`,
      "Content-Disposition": `${inline ? "inline" : "attachment"}; filename*=UTF-8''${encodeURIComponent(a.name)}`,
      "Cache-Control": "private, max-age=31536000, immutable",
      "X-Content-Type-Options": "nosniff",
    },
  });
}

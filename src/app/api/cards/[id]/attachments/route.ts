import { logActivity, requireCard } from "~/server/api/access";
import { auth } from "~/server/auth";
import { db } from "~/server/db";
import { saveFile } from "~/server/storage";

const MAX_BYTES = 100 * 1024 * 1024; // per request: the whole body is held in memory
const MAX_FILES = 20;

export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const session = await auth();
  if (!session?.user) return new Response("Unauthorized", { status: 401 });
  const { id: cardId } = await params;
  let boardId: string;
  try {
    boardId = await requireCard(db, session.user.id, cardId);
  } catch {
    return new Response("Forbidden", { status: 403 });
  }
  const form = await req.formData();
  const files = form.getAll("file").filter((f): f is File => f instanceof File);
  if (files.length === 0) return new Response("No files", { status: 400 });
  if (files.length > MAX_FILES) return new Response(`Up to ${MAX_FILES} files at a time`, { status: 413 });
  if (files.reduce((n, f) => n + f.size, 0) > MAX_BYTES) return new Response("Uploads must total under 100 MB", { status: 413 });
  const created = [];
  for (const file of files) {
    const storageKey = await saveFile(new Uint8Array(await file.arrayBuffer()));
    const a = await db.attachment.create({
      data: {
        cardId,
        uploaderId: session.user.id,
        name: file.name,
        mimeType: file.type || null,
        size: file.size,
        isUpload: true,
        storageKey,
        url: "",
      },
    });
    const url = `/api/files/${a.id}`;
    await db.attachment.update({ where: { id: a.id }, data: { url } });
    // First image attached becomes the cover, matching Trello.
    if (file.type.startsWith("image/")) {
      await db.card.updateMany({
        where: { id: cardId, coverAttachmentId: null, coverColor: null },
        data: { coverAttachmentId: a.id },
      });
    }
    created.push({ ...a, url });
  }
  logActivity(db, {
    boardId,
    cardId,
    actorId: session.user.id,
    type: "addAttachment",
    data: { name: files.map((f) => f.name).join(", ") },
    origin: req.headers.get("x-client-id") ?? undefined,
  });
  return Response.json(created);
}

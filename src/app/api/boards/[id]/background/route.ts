import { requireBoard, touch } from "~/server/api/access";
import { sessionFor } from "~/server/auth/session";
import { db } from "~/server/db";
import { bodyTooBig, boardBgPath, imageType, removeBoardBg, saveFile } from "~/server/storage";

const MAX_BYTES = 10 * 1024 * 1024;

/** Upload an image as the board's background (multipart field "file"). Same access as changing it by URL. */
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const session = await sessionFor(req);
  if (!session?.user) return new Response("Unauthorized", { status: 401 });
  const { id } = await params;
  let old: string | null;
  try {
    old = (await requireBoard(db, session.user.id, id)).bgImage;
  } catch {
    return new Response("Forbidden", { status: 403 });
  }
  if (bodyTooBig(req, MAX_BYTES)) return new Response("Backgrounds must be under 10 MB.", { status: 413 });
  const file = (await req.formData()).get("file");
  if (!(file instanceof File)) return new Response("No file", { status: 400 });
  if (file.size > MAX_BYTES) return new Response("Backgrounds must be under 10 MB.", { status: 413 });
  const data = new Uint8Array(await file.arrayBuffer());
  if (!imageType(data)) return new Response("Use a PNG, JPEG, GIF or WebP image.", { status: 415 });
  const bgImage = boardBgPath(id, await saveFile(data));
  await db.board.update({ where: { id }, data: { bgImage } });
  await removeBoardBg(old);
  touch(id);
  return Response.json({ bgImage });
}

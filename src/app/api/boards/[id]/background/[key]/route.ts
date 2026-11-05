import { requireBoard } from "~/server/api/access";
import { sessionFor } from "~/server/auth/session";
import { db } from "~/server/db";
import { boardBgKey, imageType, readStored } from "~/server/storage";

/** Anyone who can open the board sees its uploaded background (public boards too). */
export async function GET(req: Request, { params }: { params: Promise<{ id: string; key: string }> }) {
  const session = await sessionFor(req);
  const { id, key } = await params;
  let board;
  try {
    board = await requireBoard(db, session?.user?.id ?? "", id, false);
  } catch {
    return new Response("Not found", { status: 404 });
  }
  // Only the board's current background, so a board can't be used to read any other stored file.
  if (boardBgKey(board.bgImage) !== key) return new Response("Not found", { status: 404 });
  const data = new Uint8Array(await readStored(key));
  return new Response(data, {
    headers: {
      "Content-Type": imageType(data) ?? "application/octet-stream",
      // Each upload gets a new key, so the URL never changes content.
      "Cache-Control": "private, max-age=31536000, immutable",
      "X-Content-Type-Options": "nosniff",
    },
  });
}

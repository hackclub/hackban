import { requireBoard } from "~/server/api/access";
import { auth } from "~/server/auth";
import { db } from "~/server/db";

/** Full board as JSON (lists, cards, labels, checklists, comments, members). */
export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const session = await auth();
  if (!session?.user) return new Response("Unauthorized", { status: 401 });
  const { id } = await params;
  try {
    await requireBoard(db, session.user.id, id, false);
  } catch {
    return new Response("Not found", { status: 404 });
  }
  const board = await db.board.findUniqueOrThrow({
    where: { id },
    include: {
      labels: true,
      members: { include: { user: { select: { id: true, name: true, username: true } } } },
      lists: {
        orderBy: { pos: "asc" },
        include: {
          cards: {
            orderBy: { pos: "asc" },
            include: {
              labels: true,
              members: { select: { userId: true } },
              checklists: { orderBy: { pos: "asc" }, include: { items: { orderBy: { pos: "asc" } } } },
              attachments: { select: { id: true, name: true, url: true, mimeType: true, size: true, createdAt: true } },
              comments: { orderBy: { createdAt: "asc" }, include: { author: { select: { id: true, name: true } } } },
            },
          },
        },
      },
    },
  });
  const slug = board.name.replace(/[^\w-]+/g, "-").toLowerCase();
  return new Response(JSON.stringify({ exportedAt: new Date(), board }, null, 2), {
    headers: {
      "Content-Type": "application/json",
      "Content-Disposition": `attachment; filename="${slug || "board"}.json"`,
    },
  });
}

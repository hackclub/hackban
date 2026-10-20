import { notFound } from "next/navigation";

import { BoardView } from "~/app/_components/board/board-view";
import { requireUser } from "~/server/auth/require";
import { db } from "~/server/db";

export default async function CardPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const user = await requireUser(`/c/${id}`);
  const card = await db.card.findUnique({ where: { id }, select: { list: { select: { boardId: true } } } });
  if (!card) notFound();
  return <BoardView boardId={card.list.boardId} initialCardId={id} user={user} />;
}

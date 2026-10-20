import { BoardView } from "~/app/_components/board/board-view";
import { requireUser } from "~/server/auth/require";

export default async function BoardPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const user = await requireUser(`/b/${id}`);
  return <BoardView boardId={id} user={user} />;
}

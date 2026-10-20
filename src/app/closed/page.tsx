import { ClosedBoards } from "~/app/_components/home";
import { Header } from "~/app/_components/header";
import { requireUser } from "~/server/auth/require";

export default async function ClosedPage() {
  const user = await requireUser("/closed");
  return (
    <div className="flex min-h-full flex-col">
      <Header user={user} />
      <ClosedBoards />
    </div>
  );
}

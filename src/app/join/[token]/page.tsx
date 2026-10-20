import { Header } from "~/app/_components/header";
import { JoinBoard } from "~/app/_components/join-board";
import { requireUser } from "~/server/auth/require";

export default async function JoinPage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const user = await requireUser(`/join/${token}`);
  return (
    <div className="flex min-h-full flex-col">
      <Header user={user} />
      <JoinBoard token={token} />
    </div>
  );
}

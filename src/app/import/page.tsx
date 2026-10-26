import { Header } from "~/app/_components/header";
import { Importer } from "~/app/_components/importer";
import { requireUser } from "~/server/auth/require";

export default async function ImportPage() {
  const user = await requireUser("/import");
  return (
    <div className="flex min-h-full flex-col">
      <Header user={user} />
      {user.isAdmin ? (
        <Importer />
      ) : (
        <main className="mx-auto w-full max-w-[860px] px-4 py-10">
          <h1 className="mb-1 text-2xl font-semibold">Import from Trello</h1>
          <p className="text-[var(--color-text-subtle)]">
            Trello imports are run by Hackban admins. Ask one in the <b>#hackban</b> channel on the Hack Club Slack to get your import set up.
          </p>
        </main>
      )}
    </div>
  );
}

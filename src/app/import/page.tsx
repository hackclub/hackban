import { Header } from "~/app/_components/header";
import { Importer } from "~/app/_components/importer";
import { requireUser } from "~/server/auth/require";

export default async function ImportPage() {
  const user = await requireUser("/import");
  return (
    <div className="flex min-h-full flex-col">
      <Header user={user} />
      <Importer />
    </div>
  );
}

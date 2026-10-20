import { Header } from "~/app/_components/header";
import { Home } from "~/app/_components/home";
import { requireUser } from "~/server/auth/require";

export default async function HomePage() {
  const user = await requireUser("/");
  return (
    <div className="flex min-h-full flex-col">
      <Header user={user} />
      <Home />
    </div>
  );
}

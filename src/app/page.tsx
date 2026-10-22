import { Header } from "~/app/_components/header";
import { Home } from "~/app/_components/home";
import { requireUser } from "~/server/auth/require";

export default async function HomePage() {
  const user = await requireUser("/");
  return (
    <div className="flex min-h-full flex-col">
      <Header user={user} />
      <Home />
      <footer className="fixed right-3 bottom-2 text-xs opacity-50">
        {process.env.BUILD_COMMIT && (
          <a
            href={`https://github.com/hackclub/hackban/commit/${process.env.BUILD_COMMIT}`}
            className="hover:underline"
          >
            {process.env.BUILD_COMMIT.slice(0, 7)}
          </a>
        )}{" "}
        · built {new Date(process.env.BUILD_TIME!).toLocaleString()}
      </footer>
    </div>
  );
}

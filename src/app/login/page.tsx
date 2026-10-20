import { redirect } from "next/navigation";

import { auth, signIn } from "~/server/auth";

export default async function LoginPage({ searchParams }: { searchParams: Promise<{ callbackUrl?: string }> }) {
  const session = await auth();
  const { callbackUrl } = await searchParams;
  if (session?.user) redirect(callbackUrl ?? "/");
  return (
    <main className="flex min-h-full flex-col items-center justify-center bg-[var(--color-modal)] px-4">
      <div className="w-full max-w-[400px] rounded-[3px] bg-[var(--color-surface)] px-10 py-8 text-center shadow-[var(--shadow-overlay)]">
        <div className="mb-6 flex items-center justify-center gap-2 text-[28px] font-bold text-[var(--color-text)]">
          <Logo />
          Hackban
        </div>
        <h1 className="mb-6 text-base font-semibold text-[var(--color-text-subtle)]">Log in to continue</h1>
        <form
          action={async () => {
            "use server";
            await signIn("hackclub", { redirectTo: callbackUrl ?? "/" });
          }}
        >
          <button className="flex h-10 w-full items-center justify-center gap-2 rounded-[3px] bg-[#ec3750] font-semibold text-white shadow-[0_1px_1px_#091e4240] transition-colors hover:bg-[#d62a42]">
            Continue with Hack Club
          </button>
        </form>
        <p className="mt-6 text-xs text-[var(--color-text-subtle)]">Trello, but it&apos;s ours.</p>
      </div>
    </main>
  );
}

function Logo() {
  return (
    <svg width="32" height="32" viewBox="0 0 32 32" aria-hidden>
      <rect width="32" height="32" rx="6" fill="#0c66e4" />
      <rect x="6" y="6" width="8.5" height="18" rx="2" fill="#fff" />
      <rect x="17.5" y="6" width="8.5" height="11" rx="2" fill="#fff" />
    </svg>
  );
}

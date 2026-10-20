"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";

import { api } from "~/trpc/react";

import { Button, boardBg } from "./ui";

/** Landing page for a board invite link: preview the board, then join it. */
export function JoinBoard({ token }: { token: string }) {
  const router = useRouter();
  const { data: board, error, isLoading } = api.board.invitePreview.useQuery({ token }, { retry: false });
  const join = api.board.joinByInvite.useMutation({ onSuccess: ({ boardId }) => router.push(`/b/${boardId}`) });

  return (
    <main className="flex flex-1 items-start justify-center px-4 pt-[12vh]">
      <div className="animate-pop-in w-full max-w-[420px] overflow-hidden rounded-xl bg-[var(--color-overlay)] shadow-[var(--shadow-overlay)]">
        {isLoading && <div className="skeleton h-56" />}
        {error && (
          <div className="p-8 text-center">
            <h1 className="mb-2 text-lg font-semibold">This invite link doesn&apos;t work</h1>
            <p className="mb-6 text-sm text-[var(--color-text-subtle)]">
              It may have been turned off or reset. Ask a board admin for a new link.
            </p>
            <Link href="/">
              <Button>Go to your boards</Button>
            </Link>
          </div>
        )}
        {board && (
          <>
            <div className="flex h-28 items-end p-4" style={boardBg(board)}>
              <span className="text-lg font-bold text-white [text-shadow:0_1px_4px_#0008]">{board.name}</span>
            </div>
            <div className="p-6">
              <p className="mb-1 text-sm text-[var(--color-text-subtle)]">
                {board.workspace.name} · {board._count.members} member{board._count.members === 1 ? "" : "s"}
              </p>
              {board.alreadyMember ? (
                <>
                  <p className="mb-5 text-sm">You&apos;re already on this board.</p>
                  <Button variant="primary" className="w-full" onClick={() => router.push(`/b/${board.id}`)}>
                    Open board
                  </Button>
                </>
              ) : (
                <>
                  <p className="mb-5 text-sm">
                    You&apos;ve been invited to join this board as {board.inviteRole === "observer" ? "an Observer (view only)" : "a Member"}. You&apos;ll
                    only get access to this board, not the rest of the workspace.
                  </p>
                  <Button variant="primary" className="w-full" disabled={join.isPending} onClick={() => join.mutate({ token })}>
                    {join.isPending ? "Joining…" : "Join board"}
                  </Button>
                  {join.error && <p className="mt-2 text-sm text-[var(--color-danger)]">{join.error.message}</p>}
                </>
              )}
            </div>
          </>
        )}
      </div>
    </main>
  );
}

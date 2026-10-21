"use client";

import { AnimatePresence, motion } from "framer-motion";
import { useContext, useEffect, useState } from "react";

import { api } from "~/trpc/react";

import { Icon } from "../ui";
import { BoardCtx } from "./members";
import { memberPatch, usePatchCard } from "./optimistic";

const VISIBLE_MS = 7000;

/**
 * A quiet "✦ Assign to you?" nudge that fades in under a list right after you
 * add a card, and fades out on its own. One click assigns you instantly.
 * Never covers the card or the composer.
 */
export function AssignSuggestion({
  boardId,
  card,
  onDone,
}: {
  boardId: string;
  card: { id: string; title: string } | null;
  onDone: () => void;
}) {
  const { meId } = useContext(BoardCtx);
  const { data: board } = api.board.get.useQuery({ id: boardId });
  const patch = usePatchCard(boardId);
  const [assigned, setAssigned] = useState(false);
  const join = api.card.toggleMember.useMutation({
    onMutate: ({ userId }) => patch(card!.id, memberPatch(board?.members.find((m) => m.userId === userId), userId, true)),
  });

  // Fresh card -> reset, then auto-dismiss.
  useEffect(() => {
    setAssigned(false);
    if (!card) return;
    const t = setTimeout(onDone, VISIBLE_MS);
    return () => clearTimeout(t);
  }, [card, onDone]);

  const live = board?.lists.flatMap((l) => l.cards).find((c) => c.id === card?.id);
  const alreadyMine = !!live?.members.some((m) => m.userId === meId);
  const show = !!card && !card.id.startsWith("temp-") && board?.myRole !== "observer" && (!alreadyMine || assigned);

  return (
    <AnimatePresence>
      {show && card && (
        <motion.div
          key={card.id}
          initial={{ opacity: 0, y: 4, filter: "blur(2px)" }}
          animate={{ opacity: 1, y: 0, filter: "blur(0px)" }}
          exit={{ opacity: 0, y: 2 }}
          transition={{ duration: 0.22, ease: [0.2, 0.8, 0.3, 1] }}
          className="ai-glow mx-2 mt-2 rounded-lg p-px"
        >
          <div className="flex items-center gap-2 rounded-[7px] bg-[var(--color-list)] px-2 py-1.5 text-xs">
            <span className="ai-sparkle text-[#9f8fef]" aria-hidden>
              ✦
            </span>
            {assigned ? (
              <span className="flex-1 text-[var(--color-text-subtle)]">Assigned to you</span>
            ) : (
              <>
                <span className="min-w-0 flex-1 truncate text-[var(--color-text-subtle)]" title={card.title}>
                  Assign <span className="text-[var(--color-text)]">{card.title}</span> to you?
                </span>
                <button
                  onClick={() => {
                    setAssigned(true);
                    join.mutate({ id: card.id, userId: meId, on: true });
                    setTimeout(onDone, 1200);
                  }}
                  className="shrink-0 rounded-[4px] bg-[var(--color-neutral)] px-2 py-0.5 font-medium text-[var(--color-text)] transition-colors hover:bg-[var(--color-neutral-hover)]"
                >
                  Assign me
                </button>
                <button onClick={onDone} className="shrink-0 rounded p-0.5 text-[var(--color-text-subtlest)] hover:bg-[var(--color-neutral)]" aria-label="Dismiss">
                  <Icon name="close" size={12} />
                </button>
              </>
            )}
          </div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}

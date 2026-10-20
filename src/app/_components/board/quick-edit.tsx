"use client";

import { motion } from "framer-motion";
import { useState } from "react";
import { createPortal } from "react-dom";

import { api } from "~/trpc/react";

import { AutoTextarea, Button } from "../ui";
import { CardPopover, type PopKind } from "./card-popovers";
import { SideButton } from "./card-modal";
import { type BoardData, type CardData } from "./types";

/** Trello's "quick card editor": dims the board and edits the card in place. */
export function QuickEdit({ card, rect, board, onClose, onOpen }: { card: CardData; rect: DOMRect; board: BoardData; onClose: () => void; onOpen: () => void }) {
  const [title, setTitle] = useState(card.title);
  const [pop, setPop] = useState<{ kind: PopKind; el: HTMLElement } | null>(null);
  const utils = api.useUtils();
  const { data: detail } = api.card.get.useQuery({ id: card.id });
  const inv = () => {
    void utils.board.get.invalidate({ id: board.id });
    void utils.card.get.invalidate({ id: card.id });
  };
  const update = api.card.update.useMutation({
    onMutate: (d) =>
      utils.board.get.setData({ id: board.id }, (b) =>
        b && {
          ...b,
          lists: b.lists.map((l) => ({
            ...l,
            cards: d.closed ? l.cards.filter((c) => c.id !== card.id) : l.cards.map((c) => (c.id === card.id ? { ...c, title: d.title ?? c.title, dueComplete: d.dueComplete ?? c.dueComplete } : c)),
          })),
        },
      ),
    onSettled: inv,
  });
  const save = () => {
    if (title.trim() && title.trim() !== card.title) update.mutate({ id: card.id, title: title.trim() });
    onClose();
  };
  const openPop = (kind: PopKind) => (e: React.MouseEvent) => setPop({ kind, el: e.currentTarget as HTMLElement });
  const flipLeft = rect.right + 200 > window.innerWidth;

  return createPortal(
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      transition={{ duration: 0.1 }}
      className="fixed inset-0 z-40 bg-black/60"
      onMouseDown={(e) => e.target === e.currentTarget && save()}
      onKeyDown={(e) => e.key === "Escape" && onClose()}
    >
      <div className="absolute" style={{ top: Math.min(rect.top, window.innerHeight - 260), left: rect.left, width: rect.width }}>
        <AutoTextarea
          autoFocus
          onFocus={(e) => e.currentTarget.select()}
          minRows={4}
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              save();
            }
            if (e.key === "Escape") onClose();
          }}
          className="block w-full rounded-lg bg-[var(--color-surface)] px-3 py-2 text-sm shadow-[var(--shadow-card)] outline-none"
        />
        <Button variant="primary" className="mt-2" onClick={save}>Save</Button>
        <motion.div
          initial={{ opacity: 0, x: flipLeft ? 8 : -8 }}
          animate={{ opacity: 1, x: 0 }}
          transition={{ duration: 0.12, delay: 0.03 }}
          className={`absolute top-0 flex w-max flex-col items-start gap-1 ${flipLeft ? "right-full mr-2 items-end" : "left-full ml-2"}`}
        >
          {[
            ["card", "Open card", onOpen],
            ["check", card.dueComplete ? "Mark incomplete" : "Mark complete", () => { update.mutate({ id: card.id, dueComplete: !card.dueComplete }); onClose(); }],
            ["label", "Edit labels", openPop("labels")],
            ["user", "Change members", openPop("members")],
            ["cover", "Change cover", openPop("cover")],
            ["clock", "Edit dates", openPop("dates")],
            ["move", "Move", openPop("move")],
            ["copy", "Copy", openPop("copy")],
            ["archive", "Archive", () => { update.mutate({ id: card.id, closed: true }); onClose(); }],
          ].map(([icon, label, fn]) => (
            <SideButton key={label as string} icon={icon as string} onClick={fn as (e: React.MouseEvent) => void} className="w-auto bg-[#000000b3] text-white hover:bg-black hover:translate-x-1 transition-transform">
              {label as string}
            </SideButton>
          ))}
        </motion.div>
      </div>
      {detail && (
        <CardPopover kind={pop?.kind ?? null} anchor={pop ? { el: pop.el } : null} onClose={() => setPop(null)} card={detail} board={board} />
      )}
    </motion.div>,
    document.body,
  );
}

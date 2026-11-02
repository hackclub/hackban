"use client";

import { format } from "date-fns";
import { memo, useEffect, useState } from "react";

import { api } from "~/trpc/react";

import {
  Avatar,
  Icon,
  coverColor,
  dueState,
  dueStyles,
  labelStyle,
} from "../ui";
import { confetti } from "../confetti";
import { CardMemberAvatar } from "./members";
import { fieldsPatch, usePatchCard } from "./optimistic";
import { type CardData } from "./types";

// Trello's label "collapse" toggle is global and remembered per browser.
const LABELS_KEY = "hackban:labels-expanded";
let labelsExpanded = true;
const listeners = new Set<(v: boolean) => void>();
function useLabelsExpanded() {
  const [v, setV] = useState(labelsExpanded);
  useEffect(() => {
    try {
      const stored = localStorage.getItem(LABELS_KEY);
      if (stored !== null) labelsExpanded = stored === "1";
    } catch {}
    setV(labelsExpanded);
    listeners.add(setV);
    return () => void listeners.delete(setV);
  }, []);
  const toggle = () => {
    labelsExpanded = !labelsExpanded;
    try {
      localStorage.setItem(LABELS_KEY, labelsExpanded ? "1" : "0");
    } catch {}
    listeners.forEach((l) => l(labelsExpanded));
  };
  return [v, toggle] as const;
}

export const CardFront = memo(function CardFront({
  card,
  boardId,
  dragging,
  overlay,
  onOpen,
  onQuickEdit,
  readOnly = false,
}: {
  card: CardData;
  boardId: string;
  dragging?: boolean;
  overlay?: boolean;
  onOpen?: () => void;
  onQuickEdit?: (el: HTMLElement) => void;
  /** Observers: no complete/due toggles. */
  readOnly?: boolean;
}) {
  const [expanded, toggleLabels] = useLabelsExpanded();
  const utils = api.useUtils();
  const patch = usePatchCard(boardId);
  const toggleDue = api.card.update.useMutation({
    // Instant on the card front and, if it's open, the card back.
    onMutate: ({ dueComplete }) => patch(card.id, fieldsPatch({ dueComplete: dueComplete! })),
    onSettled: (_d, _e, vars) => {
      // A repeating card is rolled forward by the server; let it read as done
      // for a beat before it jumps to its next date.
      const delay = vars.dueComplete && card.recurrence ? REPEAT_SHOW_DONE_MS : 0;
      setTimeout(() => {
        void utils.board.get.invalidate({ id: boardId });
        void utils.card.get.invalidate({ id: card.id });
      }, delay);
    },
  });
  const setComplete = (v: boolean) =>
    toggleDue.mutate({ id: card.id, dueComplete: v });
  const due = dueState(card.due, card.dueComplete);
  // Right-click opens the quick editor (Trello's hover pencil, without the pencil).
  const onContextMenu = onQuickEdit
    ? (e: React.MouseEvent<HTMLElement>) => {
        e.preventDefault();
        onQuickEdit(
          e.currentTarget.closest<HTMLElement>("[data-card]") ??
            e.currentTarget,
        );
      }
    : undefined;
  const fullCover =
    card.coverSize === "full" && (card.coverColor ?? card.coverUrl);

  // While dragging, the card's own slot renders as a faded "ghost" of itself,
  // so the drop gap is exactly the card's size and shape.
  const state = dragging
    ? "pointer-events-none opacity-35 shadow-none! saturate-50 transition-opacity duration-150"
    : overlay
      ? ""
      : "hover:outline-2 hover:outline-[var(--color-focus)]";


  if (fullCover) {
    return (
      <div
        onClick={onOpen}
        onContextMenu={onContextMenu}
        className={`group relative cursor-pointer overflow-hidden rounded-lg shadow-[var(--shadow-card)] ${state}`}
        style={
          card.coverUrl
            ? {
                backgroundImage: `url("${card.coverUrl}")`,
                backgroundSize: "cover",
                backgroundPosition: "center",
                minHeight: 120,
              }
            : { background: coverColor(card.coverColor!) }
        }
      >
        <div
          className={`flex min-h-[56px] items-end p-3 ${card.coverUrl ? "bg-gradient-to-t from-black/60 to-transparent pt-16 text-white" : ""}`}
        >
          <CardTitle title={card.title} complete={card.dueComplete} onChange={overlay || readOnly ? undefined : setComplete} className="text-base font-medium" />
        </div>
      </div>
    );
  }

  return (
    <div
      onClick={onOpen}
      onContextMenu={onContextMenu}
      className={`group relative cursor-pointer overflow-hidden rounded-lg bg-[var(--color-surface)] shadow-[var(--shadow-card)] ${state}`}
    >
      {card.coverUrl ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={card.coverUrl}
          alt=""
          className="block max-h-[260px] w-full object-cover"
          draggable={false}
        />
      ) : card.coverColor ? (
        <div
          className="h-9"
          style={{ background: coverColor(card.coverColor) }}
        />
      ) : null}
      <div className="px-3 pt-1.5 pb-1">
        {card.labels.length > 0 && (
          <div className="mt-0.5 mb-1 flex flex-wrap gap-1">
            {card.labels.map(({ label }) => (
              <button
                key={label.id}
                onClick={(e) => {
                  e.stopPropagation();
                  toggleLabels();
                }}
                title={label.name}
                className={`overflow-hidden rounded-[4px] text-left text-xs font-medium transition-all duration-150 hover:brightness-90 ${expanded ? "h-4 max-w-full min-w-6 truncate px-1.5 text-center leading-4" : "h-2 w-10"}`}
                style={labelStyle(label.color)}
              >
                {expanded ? label.name : null}
              </button>
            ))}
          </div>
        )}
        <CardTitle title={card.title} complete={card.dueComplete} onChange={overlay || readOnly ? undefined : setComplete} />
        <div className="mt-1 flex flex-wrap items-center gap-x-1 gap-y-0.5 pb-0.5 text-xs text-[var(--color-text-subtle)]">
          {card.blockedBy.length > 0 && (
            <span
              className="flex h-6 items-center gap-1 rounded-[3px] bg-[var(--color-danger)] px-1 text-white"
              title={`Blocked by: ${card.blockedBy.map((b) => b.blocker.title).join(", ")}`}
            >
              <Icon name="blocked" size={14} />
              Blocked
            </span>
          )}
          {card.blocking.length > 0 && !card.dueComplete && (
            <span
              className="flex h-6 items-center gap-1 rounded-[3px] bg-[var(--color-warning)] px-1 text-[#172b4d]"
              title={`Blocking: ${card.blocking.map((b) => b.blocked.title).join(", ")}`}
            >
              <Icon name="blocked" size={14} />
              Blocking {card.blocking.length}
            </span>
          )}
          {card.issues.map((i) => {
            const closed = i.state === "closed";
            return (
              <a
                key={i.id}
                href={`https://github.com/${i.owner}/${i.repo}/issues/${i.number}`}
                target="_blank"
                rel="noreferrer"
                onClick={(e) => e.stopPropagation()}
                className={`flex h-6 items-center gap-1 rounded-[3px] px-1 hover:underline ${i.fetchError ? "text-[var(--color-text-subtlest)]" : closed ? "text-[var(--color-brand)]" : "text-[var(--color-success)]"}`}
                title={`${i.owner}/${i.repo}#${i.number}${i.title ? `: ${i.title}` : ""} (${i.fetchError ? "can't read" : closed ? "closed" : "open"})`}
              >
                <Icon name={closed ? "issueClosed" : "issue"} size={14} />#{i.number}
              </a>
            );
          })}
          {card.watching && (
            <span className="flex h-6 items-center px-1" title="You are watching this card.">
              <Icon name="eye" size={16} />
            </span>
          )}
          {card.due && (
            <button
              onClick={(e) => {
                e.stopPropagation();
                if (readOnly) return;
                if (!card.dueComplete) confetti(e.currentTarget);
                setComplete(!card.dueComplete);
              }}
              className={`group/due flex h-6 items-center gap-1 rounded-[3px] px-1 ${due ? dueStyles[due] : ""} ${due === "later" ? "hover:bg-[var(--color-neutral)]" : ""} ${readOnly ? "pointer-events-none" : ""}`}
            >
              <span className="group-hover/due:hidden">
                <Icon name="clock" size={14} />
              </span>
              <span className="hidden group-hover/due:inline">
                <Icon name="check" size={14} />
              </span>
              {card.start && `${shortDate(card.start)} - `}
              {shortDate(card.due)}
              {card.recurrence && (
                <span title={`Repeats ${card.recurrence === "weekdays" ? "every weekday" : card.recurrence}`}>
                  <Icon name="repeat" size={12} />
                </span>
              )}
            </button>
          )}
          {card.start && !card.due && (
            <span className="flex h-6 items-center gap-1 px-1">
              <Icon name="clock" size={14} />
              Started: {shortDate(card.start)}
            </span>
          )}
          {card.description && (
            <span
              className="flex h-6 items-center px-1"
              title="This card has a description."
            >
              <Icon name="desc" size={14} />
            </span>
          )}
          {card._count.comments > 0 && (
            <span className="flex h-6 items-center gap-1 px-1" title="Comments">
              <Icon name="comment" size={14} />
              {card._count.comments}
            </span>
          )}
          {card._count.attachments > 0 && (
            <span
              className="flex h-6 items-center gap-1 px-1"
              title="Attachments"
            >
              <Icon name="attach" size={14} />
              {card._count.attachments}
            </span>
          )}
          {card.checkTotal > 0 && (
            <span
              className={`flex h-6 items-center gap-1 rounded-[3px] px-1 ${card.checkDone === card.checkTotal ? "bg-[#1f845a] text-white" : ""}`}
              title="Checklist items"
            >
              <Icon name="check" size={14} />
              {card.checkDone}/{card.checkTotal}
            </span>
          )}
          {card.members.length > 0 && (
            <span className="ml-auto flex flex-row-reverse gap-0.5 py-0.5">
              {[...card.members].reverse().map((m) =>
                overlay ? <Avatar key={m.userId} user={m.user} size={24} /> : <CardMemberAvatar key={m.userId} boardId={boardId} user={m.user} />,
              )}
            </span>
          )}
        </div>
      </div>
    </div>
  );
});

/**
 * Trello's round "mark complete" check. On card fronts it's shown on hover or
 * once complete (see CardTitle); the card modal always shows it.
 */
/** How long a just-completed repeating card shows as done before rolling over. */
export const REPEAT_SHOW_DONE_MS = 1500;

/**
 * Card title with the mark-complete circle on its left. The circle is
 * absolutely positioned and the title glides over with a transform (into the
 * card's right padding), so wrapping and card height never change on hover.
 */
function CardTitle({ title, complete, onChange, className = "" }: { title: string; complete: boolean; onChange?: (v: boolean) => void; className?: string }) {
  return (
    <div className={`relative pr-6 break-words ${className}`}>
      <CompleteCheck
        complete={complete}
        onChange={onChange}
        className={`absolute top-0 left-0 flex h-5 items-center transition-opacity duration-150 ${
          complete ? "opacity-100" : "opacity-0 group-hover:opacity-100 focus-within:opacity-100"
        }`}
      />
      <span
        className={`block transition-transform duration-200 ease-out ${complete ? "translate-x-[22px]" : "group-hover:translate-x-[22px]"}`}
      >
        {title}
      </span>
    </div>
  );
}

export function CompleteCheck({
  complete,
  onChange,
  size = 16,
  className = "mr-1.5 inline-flex w-[var(--cw)] shrink-0 items-center",
}: {
  complete: boolean;
  onChange?: (v: boolean) => void;
  size?: number;
  className?: string;
}) {
  return (
    <span
      className={className}
      style={{
        height: Math.max(20, size + 4),
        ["--cw" as string]: `${size}px`,
      }}
    >
      <button
        type="button"
        role="checkbox"
        aria-checked={complete}
        aria-label={complete ? "Mark incomplete" : "Mark complete"}
        title={complete ? "Mark incomplete" : "Mark complete"}
        onPointerDown={(e) => e.stopPropagation()}
        onClick={(e) => {
          e.stopPropagation();
          if (!onChange) return;
          if (!complete) confetti(e.currentTarget);
          onChange(!complete);
        }}
        className={`flex items-center justify-center rounded-full border-[1.5px] transition-colors ${
          complete
            ? "animate-check-pop border-[var(--color-success)] bg-[var(--color-success)] text-white"
            : "border-[var(--color-text-subtle)] hover:border-[var(--color-text)] hover:bg-[var(--color-neutral)]"
        }`}
        style={{ width: size, height: size }}
      >
        {complete && (
          <svg
            viewBox="0 0 24 24"
            width={size - 4}
            height={size - 4}
            fill="none"
            stroke="currentColor"
            strokeWidth={3.5}
            aria-hidden
          >
            <path
              d="M5 12.5l4.5 4.5L19 7.5"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          </svg>
        )}
      </button>
    </span>
  );
}

function shortDate(d: Date) {
  return format(
    d,
    d.getFullYear() === new Date().getFullYear() ? "MMM d" : "MMM d, yyyy",
  );
}

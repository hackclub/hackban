"use client";

import { format, formatDistanceToNow } from "date-fns";

import { Avatar } from "../ui";

type Act = {
  id: string;
  type: string;
  data: Record<string, unknown>;
  createdAt: Date;
  actor: { name: string | null; image: string | null };
  card?: { id: string; title: string } | null;
};

const s = (v: unknown) => (typeof v === "string" ? v : "");

function describe(a: Act, onCard: boolean) {
  const card = a.card && !onCard ? <b className="cursor-pointer hover:underline">{a.card.title}</b> : "this card";
  const d = a.data;
  switch (a.type) {
    case "createBoard": return <>created this board</>;
    case "importBoard": return <>imported this board from Trello</>;
    case "renameBoard": return <>renamed this board to {s(d.name)}</>;
    case "closeBoard": return <>closed this board</>;
    case "reopenBoard": return <>reopened this board</>;
    case "moveBoard": return <>moved this board from {s(d.from)} to {s(d.to)}</>;
    case "createList": return <>added list {s(d.name)} to this board</>;
    case "renameList": return <>renamed list to {s(d.name)}</>;
    case "archiveList": return <>archived list {s(d.name)}</>;
    case "restoreList": return <>sent list {s(d.name)} to the board</>;
    case "moveList": return <>moved list {s(d.name)}</>;
    case "createCard": return <>added {card} to this board</>;
    case "renameCard": return <>renamed {card}</>;
    case "updateDescription": return <>updated the description of {card}</>;
    case "archiveCard": return <>archived {card}</>;
    case "restoreCard": return <>sent {card} to the board</>;
    case "deleteCard": return <>deleted card {s(d.title)}</>;
    case "moveCard": return <>moved {card} from {s(d.from)} to {s(d.to)}</>;
    case "copyCard": return <>copied {card} from {s(d.from)}</>;
    case "changeDue": return d.due ? <>set {card} to be due {format(new Date(d.due as string), "MMM d 'at' h:mm a")}</> : <>removed the due date from {card}</>;
    case "recurCard": return <>completed {card}; it repeats, next due {format(new Date(d.due as string), "MMM d")}</>;
    case "changeRecurrence": return d.recurrence ? <>set {card} to repeat {s(d.recurrence) === "weekdays" ? "every weekday" : s(d.recurrence)}</> : <>stopped {card} repeating</>;
    case "completeDue": return <>marked the due date on {card} complete</>;
    case "incompleteDue": return <>marked the due date on {card} incomplete</>;
    case "addMemberToCard": return <>joined {card}</>;
    case "removeMemberFromCard": return <>left {card}</>;
    case "addChecklist": return <>added {s(d.name)} to {card}</>;
    case "removeChecklist": return <>removed {s(d.name)} from {card}</>;
    case "completeCheckItem": return <>completed {s(d.name)} on {card}</>;
    case "incompleteCheckItem": return <>marked {s(d.name)} incomplete on {card}</>;
    case "addAttachment": return <>attached {s(d.name)} to {card}</>;
    case "addMemberToBoard": return <>added a member to this board</>;
    case "joinBoard": return <>joined this board via invite link</>;
    case "archiveAllCards": return <>archived all cards in a list</>;
    case "sortList": return <>sorted a list</>;
    case "moveAllCards": return <>moved {String(d.count)} cards</>;
    default: return <>{a.type}</>;
  }
}

export function ActivityItem({ a, onCard = false, onOpenCard }: { a: Act; onCard?: boolean; onOpenCard?: (id: string) => void }) {
  return (
    <div className="flex gap-2 py-2">
      <Avatar user={a.actor} size={32} />
      <div className="min-w-0 text-sm">
        <div onClick={() => a.card && onOpenCard?.(a.card.id)}>
          <b>{a.actor.name}</b> {describe(a, onCard)}
        </div>
        <div className="text-xs text-[var(--color-text-subtle)]" title={format(a.createdAt, "PPpp")}>
          {formatDistanceToNow(a.createdAt, { addSuffix: true })}
        </div>
      </div>
    </div>
  );
}

"use client";

import { format, formatDistanceToNow } from "date-fns";
import { AnimatePresence, motion } from "framer-motion";
import { useEffect, useState } from "react";

import { api } from "~/trpc/react";

import {
  AutoTextarea,
  Avatar,
  Button,
  Icon,
  IconButton,
  Markdown,
  coverColor,
  dueState,
  inputCls,
  labelStyle,
} from "../ui";
import { ActivityItem } from "./activity";
import { CompleteCheck } from "./card-front";
import {
  CardPopover,
  uploadFiles,
  useCardInvalidate,
  type CardDetail,
  type PopKind,
} from "./card-popovers";
import { type BoardData } from "./types";

type User = { id: string; name?: string | null; image?: string | null };

export function CardModal({
  cardId,
  board,
  onClose,
  onOpenCard,
  user,
}: {
  cardId: string | null;
  board: BoardData | undefined;
  onClose: () => void;
  onOpenCard: (id: string | null) => void;
  user: User;
}) {
  return (
    <AnimatePresence>
      {cardId && board && (
        <motion.div
          key="backdrop"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.15 }}
          className="fixed inset-0 z-50 overflow-y-auto bg-black/60"
          onMouseDown={(e) => e.target === e.currentTarget && onClose()}
        >
          <motion.div
            initial={{ opacity: 0, y: 24, scale: 0.98 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 24, scale: 0.98 }}
            transition={{ duration: 0.18, ease: [0.2, 0.9, 0.3, 1] }}
            className="pointer-events-none mx-auto my-12 flex w-[768px] max-w-[calc(100vw-16px)] justify-center"
            onMouseDown={(e) => e.target === e.currentTarget && onClose()}
          >
            <CardBody
              key={cardId}
              cardId={cardId}
              board={board}
              onClose={onClose}
              onOpenCard={onOpenCard}
              user={user}
            />
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}

function CardBody({
  cardId,
  board,
  onClose,
  onOpenCard,
  user,
}: {
  cardId: string;
  board: BoardData;
  onClose: () => void;
  onOpenCard: (id: string | null) => void;
  user: User;
}) {
  const { data: card, error } = api.card.get.useQuery({ id: cardId });
  const [pop, setPop] = useState<{ kind: PopKind; el: HTMLElement } | null>(
    null,
  );
  const [dropping, setDropping] = useState(false);
  const inv = useCardInvalidate(cardId, board.id);
  const readOnly = board.myRole === "observer";

  if (error) {
    return (
      <div className="pointer-events-auto w-full rounded-xl bg-[var(--color-surface)] p-8 text-center">
        <p className="mb-4">Card not found — it may have been deleted.</p>
        <Button onClick={onClose}>Close</Button>
      </div>
    );
  }
  if (!card)
    return (
      <div className="pointer-events-auto h-96 w-full animate-pulse rounded-xl bg-[var(--color-list)]" />
    );

  const openPop = (kind: PopKind) => (e: React.MouseEvent) =>
    setPop({ kind, el: e.currentTarget as HTMLElement });
  const cover = card.coverAttachmentId
    ? card.attachments.find((a) => a.id === card.coverAttachmentId)
    : null;

  return (
    <div
      className="pointer-events-auto relative w-full overflow-hidden rounded-xl bg-[var(--color-list)] shadow-[var(--shadow-overlay)]"
      onDragOver={(e) => {
        if (readOnly || !e.dataTransfer.types.includes("Files")) return;
        e.preventDefault();
        setDropping(true);
      }}
      onDragLeave={(e) => e.currentTarget === e.target && setDropping(false)}
      onDrop={async (e) => {
        e.preventDefault();
        setDropping(false);
        const files = [...e.dataTransfer.files];
        if (files.length) {
          await uploadFiles(card.id, files);
          inv();
        }
      }}
      onPaste={async (e) => {
        const t = e.target as HTMLElement;
        if (readOnly || /INPUT|TEXTAREA/.test(t.tagName)) return;
        const files = [...e.clipboardData.files];
        if (files.length) {
          await uploadFiles(card.id, files);
          inv();
        }
      }}
    >
      {dropping && (
        <div className="pointer-events-none absolute inset-2 z-20 flex items-center justify-center rounded-lg border-2 border-dashed border-white/80 bg-black/60 text-lg font-semibold text-white">
          Drop files to upload.
        </div>
      )}
      {(card.coverColor ?? cover) && (
        <div
          className="relative flex h-[116px] items-center justify-center"
          style={
            cover
              ? { background: "var(--color-neutral-bold)" }
              : { background: coverColor(card.coverColor!) }
          }
        >
          {cover && (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={cover.url} alt="" className="h-full object-contain" />
          )}
          {!readOnly && (
            <Button
              className="absolute right-3 bottom-3 bg-black/50 text-white hover:bg-black/70"
              onClick={openPop("cover")}
            >
              <Icon name="cover" size={14} /> Cover
            </Button>
          )}
        </div>
      )}
      <IconButton
        onClick={onClose}
        className="absolute top-2 right-2 z-10 h-10 w-10 rounded-full bg-black/5 hover:bg-black/15"
        aria-label="Close"
      >
        <Icon name="close" />
      </IconButton>

      <div className="relative px-4 pt-6 pb-2 pl-14">
        <Icon
          name="card"
          size={20}
          className="absolute top-7 left-5 text-[var(--color-text-subtle)]"
        />
        <Title card={card} boardId={board.id} readOnly={readOnly} />
        <p className="mt-0.5 text-sm text-[var(--color-text-subtle)]">
          in list{" "}
          <button
            disabled={readOnly}
            onClick={openPop("move")}
            className="underline"
          >
            {card.list.name}
          </button>
          {card.watching && (
            <Icon name="eye" size={14} className="ml-2 inline" />
          )}
          {card.closed && (
            <span className="ml-2 rounded bg-[#f5cd47] px-1.5 py-0.5 text-xs font-semibold text-[#172b4d]">
              Archived
            </span>
          )}
        </p>
      </div>

      <div className="flex flex-col gap-4 px-4 pb-6 md:flex-row">
        <div className="min-w-0 flex-1 md:pl-10">
          <Badges
            card={card}
            board={board}
            openPop={openPop}
            readOnly={readOnly}
          />
          <Description card={card} boardId={board.id} readOnly={readOnly} />
          {card.attachments.length > 0 && (
            <Attachments
              card={card}
              boardId={board.id}
              onAdd={openPop("attachment")}
              readOnly={readOnly}
            />
          )}
          {card.checklists.map((cl) => (
            <Checklist
              key={cl.id}
              cl={cl}
              card={card}
              board={board}
              readOnly={readOnly}
            />
          ))}
          <ActivitySection
            card={card}
            boardId={board.id}
            user={user}
            readOnly={readOnly}
            onOpenCard={onOpenCard}
          />
        </div>

        {!readOnly && (
          <aside className="flex w-full shrink-0 flex-col gap-2 md:w-[168px]">
            <SideHeading>Add to card</SideHeading>
            <SideButton icon="user" onClick={openPop("members")}>
              Members
            </SideButton>
            <SideButton icon="label" onClick={openPop("labels")}>
              Labels
            </SideButton>
            <SideButton icon="check" onClick={openPop("checklist")}>
              Checklist
            </SideButton>
            <SideButton icon="clock" onClick={openPop("dates")}>
              Dates
            </SideButton>
            <SideButton icon="attach" onClick={openPop("attachment")}>
              Attachment
            </SideButton>
            {!card.coverColor && !card.coverAttachmentId && (
              <SideButton icon="cover" onClick={openPop("cover")}>
                Cover
              </SideButton>
            )}
            <SideHeading>Actions</SideHeading>
            <SideButton icon="move" onClick={openPop("move")}>
              Move
            </SideButton>
            <SideButton icon="copy" onClick={openPop("copy")}>
              Copy
            </SideButton>
            <WatchButton card={card} />
            <ArchiveButtons card={card} board={board} onClose={onClose} />
            <SideButton
              icon="share"
              onClick={() =>
                void navigator.clipboard.writeText(
                  `${window.location.origin}/c/${card.id}`,
                )
              }
            >
              Copy link
            </SideButton>
          </aside>
        )}
      </div>
      <CardPopover
        kind={pop?.kind ?? null}
        anchor={pop ? { el: pop.el } : null}
        onClose={() => setPop(null)}
        card={card}
        board={board}
      />
    </div>
  );
}

function SideHeading({ children }: { children: React.ReactNode }) {
  return (
    <h3 className="mt-2 text-xs font-semibold text-[var(--color-text-subtle)]">
      {children}
    </h3>
  );
}

export function SideButton({
  icon,
  children,
  onClick,
  className = "",
}: {
  icon: string;
  children: React.ReactNode;
  onClick: (e: React.MouseEvent) => void;
  className?: string;
}) {
  return (
    <button
      onClick={onClick}
      className={`flex h-8 w-full items-center gap-2 rounded-[3px] bg-[var(--color-neutral)] px-3 text-left text-sm font-medium transition-colors hover:bg-[var(--color-neutral-hover)] ${className}`}
    >
      <Icon name={icon} size={14} /> {children}
    </button>
  );
}

function Title({
  card,
  boardId,
  readOnly,
}: {
  card: CardDetail;
  boardId: string;
  readOnly: boolean;
}) {
  const [title, setTitle] = useState(card.title);
  const inv = useCardInvalidate(card.id, boardId);
  const utils = api.useUtils();
  const update = api.card.update.useMutation({
    onMutate: (d) => {
      if (d.dueComplete !== undefined)
        utils.card.get.setData(
          { id: card.id },
          (c) => c && { ...c, dueComplete: d.dueComplete! },
        );
    },
    onSettled: inv,
  });
  useEffect(() => setTitle(card.title), [card.title]);
  const save = () => {
    const t = title.trim();
    if (t && t !== card.title) update.mutate({ id: card.id, title: t });
    else setTitle(card.title);
  };
  return (
    <div className="flex items-start">
      <span className="pt-1.5">
        <CompleteCheck
          size={20}
          complete={card.dueComplete}
          onChange={
            readOnly
              ? undefined
              : (v) => update.mutate({ id: card.id, dueComplete: v })
          }
        />
      </span>
      <AutoTextarea
        readOnly={readOnly}
        value={title}
        onChange={(e) => setTitle(e.target.value.replace(/\n/g, ""))}
        onBlur={save}
        onKeyDown={(e) => {
          if (e.key === "Enter") {
            e.preventDefault();
            e.currentTarget.blur();
          }
          if (e.key === "Escape") {
            e.stopPropagation();
            setTitle(card.title);
            e.currentTarget.blur();
          }
        }}
        className="-ml-2 w-full rounded-[3px] bg-transparent px-2 py-1 text-xl font-semibold outline-none focus:bg-[var(--color-surface)] focus:shadow-[inset_0_0_0_2px_var(--color-focus)]"
      />
    </div>
  );
}

function Badges({
  card,
  board,
  openPop,
  readOnly,
}: {
  card: CardDetail;
  board: BoardData;
  openPop: (k: PopKind) => (e: React.MouseEvent) => void;
  readOnly: boolean;
}) {
  const inv = useCardInvalidate(card.id, board.id);
  const utils = api.useUtils();
  const update = api.card.update.useMutation({
    onMutate: (d) =>
      utils.card.get.setData(
        { id: card.id },
        (c) => c && { ...c, dueComplete: d.dueComplete ?? c.dueComplete },
      ),
    onSettled: inv,
  });
  const due = dueState(card.due, card.dueComplete);
  if (!card.members.length && !card.labels.length && !card.due && !card.start)
    return null;
  return (
    <div className="mb-6 flex flex-wrap gap-x-6 gap-y-3">
      {card.members.length > 0 && (
        <div>
          <h3 className="mb-1.5 text-xs font-semibold text-[var(--color-text-subtle)]">
            Members
          </h3>
          <div className="flex gap-1">
            {card.members.map((m) => (
              <Avatar key={m.userId} user={m.user} size={32} />
            ))}
            {!readOnly && (
              <button
                onClick={openPop("members")}
                className="flex h-8 w-8 items-center justify-center rounded-full bg-[var(--color-neutral)] hover:bg-[var(--color-neutral-hover)]"
                aria-label="Add member"
              >
                <Icon name="plus" />
              </button>
            )}
          </div>
        </div>
      )}
      {card.labels.length > 0 && (
        <div>
          <h3 className="mb-1.5 text-xs font-semibold text-[var(--color-text-subtle)]">
            Labels
          </h3>
          <div className="flex flex-wrap gap-1">
            {card.labels.map(({ label }) => (
              <button
                key={label.id}
                onClick={readOnly ? undefined : openPop("labels")}
                className="h-8 max-w-[200px] min-w-12 truncate rounded-[3px] px-3 text-sm font-medium hover:brightness-95"
                style={labelStyle(label.color)}
              >
                {label.name}
              </button>
            ))}
            {!readOnly && (
              <button
                onClick={openPop("labels")}
                className="flex h-8 w-8 items-center justify-center rounded-[3px] bg-[var(--color-neutral)] hover:bg-[var(--color-neutral-hover)]"
                aria-label="Add label"
              >
                <Icon name="plus" />
              </button>
            )}
          </div>
        </div>
      )}
      {(card.due ?? card.start) && (
        <div>
          <h3 className="mb-1.5 text-xs font-semibold text-[var(--color-text-subtle)]">
            {card.start && card.due
              ? "Dates"
              : card.due
                ? "Due date"
                : "Start date"}
          </h3>
          <div className="flex items-center gap-1.5">
            {card.due && (
              <input
                type="checkbox"
                disabled={readOnly}
                className="h-4 w-4 accent-[var(--color-success)]"
                checked={card.dueComplete}
                onChange={(e) =>
                  update.mutate({ id: card.id, dueComplete: e.target.checked })
                }
              />
            )}
            <button
              onClick={readOnly ? undefined : openPop("dates")}
              className="flex h-8 items-center gap-2 rounded-[3px] bg-[var(--color-neutral)] px-3 text-sm font-medium hover:bg-[var(--color-neutral-hover)]"
            >
              {card.start && format(card.start, "MMM d")}
              {card.start && card.due && " - "}
              {card.due && format(card.due, "MMM d, h:mm a")}
              {due === "complete" && (
                <span className="rounded-[3px] bg-[#1f845a] px-1 text-xs text-white">
                  Complete
                </span>
              )}
              {due === "overdue" && (
                <span className="rounded-[3px] bg-[#c9372c] px-1 text-xs text-white">
                  Overdue
                </span>
              )}
              {due === "soon" && (
                <span className="rounded-[3px] bg-[#f5cd47] px-1 text-xs text-[#172b4d]">
                  Due soon
                </span>
              )}
              <svg
                width="12"
                height="12"
                viewBox="0 0 24 24"
                fill="currentColor"
                aria-hidden
              >
                <path d="M7 9l5 5 5-5z" />
              </svg>
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

function SectionHeader({
  icon,
  title,
  children,
}: {
  icon: string;
  title: string;
  children?: React.ReactNode;
}) {
  return (
    <div className="relative mb-2 flex min-h-8 items-center gap-2">
      <Icon
        name={icon}
        size={20}
        className="absolute -left-10 text-[var(--color-text-subtle)] max-md:hidden"
      />
      <h3 className="flex-1 text-base font-semibold">{title}</h3>
      {children}
    </div>
  );
}

function Description({
  card,
  boardId,
  readOnly,
}: {
  card: CardDetail;
  boardId: string;
  readOnly: boolean;
}) {
  const [editing, setEditing] = useState(false);
  const [text, setText] = useState(card.description);
  const [expanded, setExpanded] = useState(false);
  const inv = useCardInvalidate(card.id, boardId);
  const utils = api.useUtils();
  const update = api.card.update.useMutation({
    onMutate: ({ description }) =>
      utils.card.get.setData(
        { id: card.id },
        (c) => c && { ...c, description: description! },
      ),
    onSettled: inv,
  });
  useEffect(() => {
    if (!editing) setText(card.description);
  }, [card.description, editing]);
  const long = card.description.length > 600;
  const save = () => {
    update.mutate({ id: card.id, description: text });
    setEditing(false);
  };
  return (
    <section className="mb-6">
      <SectionHeader icon="desc" title="Description">
        {card.description && !editing && !readOnly && (
          <Button onClick={() => setEditing(true)}>Edit</Button>
        )}
      </SectionHeader>
      {editing ? (
        <div>
          <AutoTextarea
            autoFocus
            minRows={6}
            value={text}
            onChange={(e) => setText(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) save();
              if (e.key === "Escape") {
                e.stopPropagation();
                setEditing(false);
              }
            }}
            placeholder="Add a more detailed description… (Markdown supported)"
            className={`${inputCls} font-mono text-[13px]`}
          />
          <div className="mt-2 flex gap-1">
            <Button variant="primary" onClick={save}>
              Save
            </Button>
            <Button variant="subtle" onClick={() => setEditing(false)}>
              Cancel
            </Button>
            <span className="ml-auto self-center text-xs text-[var(--color-text-subtlest)]">
              Markdown · ⌘↵ to save
            </span>
          </div>
        </div>
      ) : card.description ? (
        <div className="relative">
          <div
            className={`${!expanded && long ? "max-h-[300px] overflow-hidden" : ""}`}
            onClick={(e) =>
              !readOnly &&
              !(e.target as HTMLElement).closest("a") &&
              setEditing(true)
            }
          >
            <Markdown text={card.description} className="cursor-pointer" />
          </div>
          {long && (
            <Button
              className="mt-2 w-full"
              onClick={() => setExpanded(!expanded)}
            >
              {expanded ? "Show less" : "Show more"}
            </Button>
          )}
        </div>
      ) : (
        !readOnly && (
          <button
            onClick={() => setEditing(true)}
            className="block min-h-14 w-full rounded-[3px] bg-[var(--color-neutral)] px-3 py-2 text-left text-sm font-medium hover:bg-[var(--color-neutral-hover)]"
          >
            Add a more detailed description…
          </button>
        )
      )}
    </section>
  );
}

function Attachments({
  card,
  boardId,
  onAdd,
  readOnly,
}: {
  card: CardDetail;
  boardId: string;
  onAdd: (e: React.MouseEvent) => void;
  readOnly: boolean;
}) {
  const inv = useCardInvalidate(card.id, boardId);
  const del = api.card.deleteAttachment.useMutation({ onSettled: inv });
  const update = api.card.update.useMutation({ onSettled: inv });
  const rename = api.card.updateAttachment.useMutation({ onSettled: inv });
  const [showAll, setShowAll] = useState(false);
  const [confirm, setConfirm] = useState<string | null>(null);
  const items = showAll ? card.attachments : card.attachments.slice(0, 4);
  const isImage = (a: CardDetail["attachments"][number]) =>
    a.mimeType?.startsWith("image/") ??
    /\.(png|jpe?g|gif|webp|svg)$/i.test(a.url);
  return (
    <section className="mb-6">
      <SectionHeader icon="attach" title="Attachments">
        {!readOnly && <Button onClick={onAdd}>Add</Button>}
      </SectionHeader>
      {items.map((a) => {
        const ext =
          a.name.split(".").pop()?.slice(0, 4).toUpperCase() ?? "LINK";
        return (
          <div
            key={a.id}
            className="mb-2 flex gap-3 rounded-[3px] p-1 hover:bg-[var(--color-neutral)]"
          >
            <a
              href={a.url}
              target="_blank"
              rel="noreferrer"
              className="flex h-20 w-28 shrink-0 items-center justify-center overflow-hidden rounded-[3px] bg-[var(--color-neutral)] text-lg font-bold text-[var(--color-text-subtle)]"
            >
              {isImage(a) ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img
                  src={a.url}
                  alt=""
                  className="h-full w-full object-cover"
                />
              ) : a.isUpload ? (
                ext
              ) : (
                <Icon name="attach" size={24} />
              )}
            </a>
            <div className="min-w-0 py-1">
              <a
                href={a.url}
                target="_blank"
                rel="noreferrer"
                className="block truncate text-sm font-semibold hover:underline"
              >
                {a.name}
              </a>
              <div className="text-xs text-[var(--color-text-subtle)]">
                Added {formatDistanceToNow(a.createdAt, { addSuffix: true })}
                {!readOnly && (
                  <>
                    {" · "}
                    <button
                      className="underline"
                      onClick={() => {
                        const n = window.prompt("Rename attachment", a.name);
                        if (n?.trim())
                          rename.mutate({ attachmentId: a.id, name: n.trim() });
                      }}
                    >
                      Edit
                    </button>
                    {" · "}
                    {confirm === a.id ? (
                      <button
                        className="font-semibold text-[var(--color-danger)] underline"
                        onClick={() => del.mutate({ attachmentId: a.id })}
                      >
                        Confirm delete
                      </button>
                    ) : (
                      <button
                        className="underline"
                        onClick={() => setConfirm(a.id)}
                      >
                        Delete
                      </button>
                    )}
                  </>
                )}
              </div>
              {isImage(a) && !readOnly && (
                <button
                  className="mt-1 flex items-center gap-1 text-xs text-[var(--color-text-subtle)] underline"
                  onClick={() =>
                    update.mutate({
                      id: card.id,
                      coverAttachmentId:
                        card.coverAttachmentId === a.id ? null : a.id,
                    })
                  }
                >
                  <Icon name="cover" size={12} />{" "}
                  {card.coverAttachmentId === a.id
                    ? "Remove cover"
                    : "Make cover"}
                </button>
              )}
            </div>
          </div>
        );
      })}
      {card.attachments.length > 4 && (
        <Button className="mt-1" onClick={() => setShowAll(!showAll)}>
          {showAll
            ? "Show fewer attachments."
            : `View all attachments (${card.attachments.length - 4} hidden)`}
        </Button>
      )}
    </section>
  );
}

function Checklist({
  cl,
  card,
  board,
  readOnly,
}: {
  cl: CardDetail["checklists"][number];
  card: CardDetail;
  board: BoardData;
  readOnly: boolean;
}) {
  const utils = api.useUtils();
  const inv = useCardInvalidate(card.id, board.id);
  const [hideDone, setHideDone] = useState(false);
  const [adding, setAdding] = useState(false);
  const [newItem, setNewItem] = useState("");
  const [editingTitle, setEditingTitle] = useState(false);
  const [title, setTitle] = useState(cl.name);
  const [confirmDel, setConfirmDel] = useState(false);
  const patchItems = (fn: (items: typeof cl.items) => typeof cl.items) =>
    utils.card.get.setData(
      { id: card.id },
      (c) =>
        c && {
          ...c,
          checklists: c.checklists.map((x) =>
            x.id === cl.id ? { ...x, items: fn(x.items) } : x,
          ),
        },
    );
  const updateItem = api.card.updateCheckItem.useMutation({
    onMutate: ({ itemId, complete, name }) =>
      patchItems((items) =>
        items.map((i) =>
          i.id === itemId
            ? { ...i, complete: complete ?? i.complete, name: name ?? i.name }
            : i,
        ),
      ),
    onSettled: inv,
  });
  const addItem = api.card.addCheckItem.useMutation({
    onMutate: ({ name }) =>
      patchItems((items) => [
        ...items,
        {
          id: `temp-${Math.random()}`,
          checklistId: cl.id,
          name,
          pos: "~",
          complete: false,
          due: null,
          memberId: null,
          trelloId: null,
          member: null,
        },
      ]),
    onSettled: inv,
  });
  const delItem = api.card.deleteCheckItem.useMutation({
    onMutate: ({ itemId }) =>
      patchItems((items) => items.filter((i) => i.id !== itemId)),
    onSettled: inv,
  });
  const updateCl = api.card.updateChecklist.useMutation({ onSettled: inv });
  const delCl = api.card.deleteChecklist.useMutation({ onSettled: inv });
  const done = cl.items.filter((i) => i.complete).length;
  const pct = cl.items.length ? Math.round((done / cl.items.length) * 100) : 0;
  const visible = hideDone ? cl.items.filter((i) => !i.complete) : cl.items;

  return (
    <section className="mb-6">
      <div className="relative mb-2 flex min-h-8 items-center gap-2">
        <Icon
          name="check"
          size={20}
          className="absolute -left-10 text-[var(--color-text-subtle)] max-md:hidden"
        />
        {editingTitle ? (
          <div className="flex-1">
            <input
              autoFocus
              className={inputCls}
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && title.trim()) {
                  updateCl.mutate({ checklistId: cl.id, name: title.trim() });
                  setEditingTitle(false);
                }
                if (e.key === "Escape") {
                  e.stopPropagation();
                  setEditingTitle(false);
                }
              }}
              onBlur={() => setEditingTitle(false)}
            />
          </div>
        ) : (
          <h3
            onClick={() => !readOnly && setEditingTitle(true)}
            className="flex-1 cursor-pointer text-base font-semibold"
          >
            {cl.name}
          </h3>
        )}
        {done > 0 && (
          <Button onClick={() => setHideDone(!hideDone)}>
            {hideDone ? `Show checked items (${done})` : "Hide checked items"}
          </Button>
        )}
        {!readOnly &&
          (confirmDel ? (
            <Button
              variant="danger"
              onClick={() => delCl.mutate({ checklistId: cl.id })}
            >
              Delete checklist?
            </Button>
          ) : (
            <Button
              onClick={() => setConfirmDel(true)}
              onBlur={() => setConfirmDel(false)}
            >
              Delete
            </Button>
          ))}
      </div>
      <div className="mb-2 flex items-center gap-2">
        <span className="w-8 text-right text-xs text-[var(--color-text-subtle)]">
          {pct}%
        </span>
        <div className="h-2 flex-1 overflow-hidden rounded-full bg-[var(--color-neutral)]">
          <motion.div
            className="h-full rounded-full"
            animate={{
              width: `${pct}%`,
              backgroundColor: pct === 100 ? "#1f845a" : "#0c66e4",
            }}
            transition={{ duration: 0.3, ease: "easeOut" }}
          />
        </div>
      </div>
      <AnimatePresence initial={false}>
        {visible.map((i) => (
          <motion.div
            key={i.id}
            layout
            initial={{ opacity: 0, height: 0 }}
            animate={{ opacity: 1, height: "auto" }}
            exit={{ opacity: 0, height: 0 }}
          >
            <CheckItemRow
              item={i}
              readOnly={readOnly}
              onToggle={(complete) =>
                updateItem.mutate({ itemId: i.id, complete })
              }
              onRename={(name) => updateItem.mutate({ itemId: i.id, name })}
              onDelete={() => delItem.mutate({ itemId: i.id })}
            />
          </motion.div>
        ))}
      </AnimatePresence>
      {hideDone && done === cl.items.length && cl.items.length > 0 && (
        <p className="py-1 pl-10 text-sm text-[var(--color-text-subtle)]">
          Everything in this checklist is complete!
        </p>
      )}
      {!readOnly && (
        <div className="mt-2 pl-10">
          {adding ? (
            <div>
              <AutoTextarea
                autoFocus
                minRows={2}
                value={newItem}
                placeholder="Add an item"
                onChange={(e) => setNewItem(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") {
                    e.preventDefault();
                    if (newItem.trim())
                      addItem.mutate({
                        checklistId: cl.id,
                        name: newItem.trim(),
                      });
                    setNewItem("");
                  }
                  if (e.key === "Escape") {
                    e.stopPropagation();
                    setAdding(false);
                  }
                }}
                className={inputCls}
              />
              <div className="mt-2 flex gap-1">
                <Button
                  variant="primary"
                  onClick={() => {
                    if (newItem.trim())
                      addItem.mutate({
                        checklistId: cl.id,
                        name: newItem.trim(),
                      });
                    setNewItem("");
                  }}
                >
                  Add
                </Button>
                <Button variant="subtle" onClick={() => setAdding(false)}>
                  Cancel
                </Button>
              </div>
            </div>
          ) : (
            <Button onClick={() => setAdding(true)}>Add an item</Button>
          )}
        </div>
      )}
    </section>
  );
}

function CheckItemRow({
  item,
  readOnly,
  onToggle,
  onRename,
  onDelete,
}: {
  item: CardDetail["checklists"][number]["items"][number];
  readOnly: boolean;
  onToggle: (c: boolean) => void;
  onRename: (n: string) => void;
  onDelete: () => void;
}) {
  const [editing, setEditing] = useState(false);
  const [name, setName] = useState(item.name);
  return (
    <div className="group flex items-start gap-2 rounded-[3px] py-1 hover:bg-[var(--color-neutral)]">
      <span className="flex w-8 justify-center pt-1.5">
        <input
          type="checkbox"
          disabled={readOnly}
          checked={item.complete}
          onChange={(e) => onToggle(e.target.checked)}
          className="h-4 w-4 cursor-pointer accent-[var(--color-brand)]"
        />
      </span>
      {editing ? (
        <div className="flex-1 pr-1">
          <AutoTextarea
            autoFocus
            value={name}
            onChange={(e) => setName(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                if (name.trim()) onRename(name.trim());
                setEditing(false);
              }
              if (e.key === "Escape") {
                e.stopPropagation();
                setEditing(false);
              }
            }}
            className={inputCls}
          />
          <div className="mt-1 flex gap-1">
            <Button
              variant="primary"
              onMouseDown={() => {
                if (name.trim()) onRename(name.trim());
                setEditing(false);
              }}
            >
              Save
            </Button>
            <Button variant="subtle" onClick={() => setEditing(false)}>
              Cancel
            </Button>
          </div>
        </div>
      ) : (
        <>
          <span
            onClick={() => !readOnly && setEditing(true)}
            className={`flex-1 cursor-pointer py-1 text-sm break-words transition-colors ${item.complete ? "text-[var(--color-text-subtle)] line-through" : ""}`}
          >
            {item.name}
          </span>
          {item.member && <Avatar user={item.member} size={24} />}
          {item.due && (
            <span className="rounded bg-[var(--color-neutral)] px-1 text-xs leading-6">
              {format(item.due, "MMM d")}
            </span>
          )}
          {!readOnly && (
            <IconButton
              onClick={onDelete}
              className="invisible h-7 w-7 group-hover:visible"
              aria-label="Delete item"
            >
              <Icon name="trash" size={14} />
            </IconButton>
          )}
        </>
      )}
    </div>
  );
}

function ActivitySection({
  card,
  boardId,
  user,
  readOnly,
  onOpenCard,
}: {
  card: CardDetail;
  boardId: string;
  user: User;
  readOnly: boolean;
  onOpenCard: (id: string | null) => void;
}) {
  const [details, setDetails] = useState(true);
  const [text, setText] = useState("");
  const [focused, setFocused] = useState(false);
  const utils = api.useUtils();
  const inv = useCardInvalidate(card.id, boardId);
  const add = api.card.addComment.useMutation({
    onMutate: ({ text }) =>
      utils.card.get.setData(
        { id: card.id },
        (c) =>
          c && {
            ...c,
            comments: [
              {
                id: `temp-${Math.random()}`,
                cardId: c.id,
                authorId: user.id,
                text,
                trelloId: null,
                createdAt: new Date(),
                editedAt: null,
                author: {
                  id: user.id,
                  name: user.name ?? null,
                  image: user.image ?? null,
                  username: null,
                },
              },
              ...c.comments,
            ],
          },
      ),
    onSettled: inv,
  });
  const submit = () => {
    if (!text.trim()) return;
    add.mutate({ id: card.id, text: text.trim() });
    setText("");
    setFocused(false);
  };
  type Entry =
    | { kind: "comment"; c: CardDetail["comments"][number] }
    | { kind: "activity"; a: CardDetail["activities"][number] };
  const entries: Entry[] = [
    ...card.comments.map((c) => ({
      kind: "comment" as const,
      c,
      t: c.createdAt.getTime(),
    })),
    ...(details
      ? card.activities.map((a) => ({
          kind: "activity" as const,
          a,
          t: a.createdAt.getTime(),
        }))
      : []),
  ].sort((x, y) => y.t - x.t);
  return (
    <section>
      <SectionHeader icon="activity" title="Activity">
        <Button onClick={() => setDetails(!details)}>
          {details ? "Hide details" : "Show details"}
        </Button>
      </SectionHeader>
      {!readOnly && (
        <div className="relative mb-4 flex gap-2">
          <Avatar
            user={user}
            size={32}
            className="absolute -left-10 max-md:hidden"
          />
          <div
            className={`flex-1 rounded-lg bg-[var(--color-surface)] shadow-[var(--shadow-card)] transition-shadow ${focused ? "shadow-[var(--shadow-raised)]" : ""}`}
          >
            <AutoTextarea
              minRows={focused ? 3 : 1}
              value={text}
              placeholder="Write a comment…"
              onFocus={() => setFocused(true)}
              onBlur={() => !text && setFocused(false)}
              onChange={(e) => setText(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) submit();
                if (e.key === "Escape") {
                  e.stopPropagation();
                  (e.target as HTMLElement).blur();
                }
              }}
              className="w-full rounded-lg bg-transparent px-3 py-2 text-sm outline-none"
            />
            {focused && (
              <div className="px-2 pb-2">
                <Button
                  variant="primary"
                  disabled={!text.trim()}
                  onMouseDown={(e) => e.preventDefault()}
                  onClick={submit}
                >
                  Save
                </Button>
              </div>
            )}
          </div>
        </div>
      )}
      {entries.map((e) =>
        e.kind === "comment" ? (
          <CommentRow
            key={e.c.id}
            c={e.c}
            mine={e.c.authorId === user.id}
            cardId={card.id}
            boardId={boardId}
          />
        ) : (
          <div key={e.a.id} className="relative -ml-10 pl-0">
            <ActivityItem
              a={{ ...e.a, card: null }}
              onCard
              onOpenCard={(id) => onOpenCard(id)}
            />
          </div>
        ),
      )}
    </section>
  );
}

function CommentRow({
  c,
  mine,
  cardId,
  boardId,
}: {
  c: CardDetail["comments"][number];
  mine: boolean;
  cardId: string;
  boardId: string;
}) {
  const [editing, setEditing] = useState(false);
  const [text, setText] = useState(c.text);
  const [confirm, setConfirm] = useState(false);
  const inv = useCardInvalidate(cardId, boardId);
  const edit = api.card.editComment.useMutation({ onSettled: inv });
  const del = api.card.deleteComment.useMutation({ onSettled: inv });
  return (
    <div className="relative mb-3 flex gap-2">
      <Avatar
        user={c.author}
        size={32}
        className="absolute -left-10 max-md:hidden"
      />
      <div className="min-w-0 flex-1">
        <div className="text-sm">
          <b>{c.author.name}</b>{" "}
          <span
            className="text-xs text-[var(--color-text-subtle)]"
            title={format(c.createdAt, "PPpp")}
          >
            {formatDistanceToNow(c.createdAt, { addSuffix: true })}
            {c.editedAt && " (edited)"}
          </span>
        </div>
        {editing ? (
          <div>
            <AutoTextarea
              autoFocus
              minRows={2}
              className={inputCls}
              value={text}
              onChange={(e) => setText(e.target.value)}
            />
            <div className="mt-1 flex gap-1">
              <Button
                variant="primary"
                onClick={() => {
                  edit.mutate({ commentId: c.id, text });
                  setEditing(false);
                }}
              >
                Save
              </Button>
              <Button variant="subtle" onClick={() => setEditing(false)}>
                Discard changes
              </Button>
            </div>
          </div>
        ) : (
          <div className="mt-1 rounded-lg bg-[var(--color-surface)] px-3 py-2 text-sm shadow-[var(--shadow-card)]">
            <Markdown text={c.text} />
          </div>
        )}
        {mine && !editing && (
          <div className="mt-0.5 flex gap-2 text-xs text-[var(--color-text-subtle)]">
            <button className="underline" onClick={() => setEditing(true)}>
              Edit
            </button>
            ·
            {confirm ? (
              <button
                className="font-semibold text-[var(--color-danger)] underline"
                onClick={() => del.mutate({ commentId: c.id })}
              >
                Delete comment? Click to confirm
              </button>
            ) : (
              <button className="underline" onClick={() => setConfirm(true)}>
                Delete
              </button>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

function WatchButton({ card }: { card: CardDetail }) {
  const utils = api.useUtils();
  const watch = api.card.watch.useMutation({
    onMutate: ({ on }) =>
      utils.card.get.setData(
        { id: card.id },
        (c) => c && { ...c, watching: on },
      ),
    onSettled: () => {
      void utils.card.get.invalidate({ id: card.id });
      void utils.board.get.invalidate({ id: card.list.boardId });
    },
  });
  return (
    <SideButton
      icon="eye"
      onClick={() => watch.mutate({ id: card.id, on: !card.watching })}
    >
      Watch{" "}
      {card.watching && (
        <span className="ml-auto rounded bg-[#1f845a] px-1 text-xs text-white">
          ✓
        </span>
      )}
    </SideButton>
  );
}

function ArchiveButtons({
  card,
  board,
  onClose,
}: {
  card: CardDetail;
  board: BoardData;
  onClose: () => void;
}) {
  const utils = api.useUtils();
  const inv = useCardInvalidate(card.id, board.id);
  const update = api.card.update.useMutation({
    onMutate: ({ closed }) =>
      utils.card.get.setData(
        { id: card.id },
        (c) => c && { ...c, closed: closed! },
      ),
    onSettled: () => {
      inv();
      void utils.board.archived.invalidate({ id: board.id });
    },
  });
  const del = api.card.delete.useMutation({
    onSuccess: () => {
      onClose();
      void utils.board.get.invalidate({ id: board.id });
    },
  });
  const [confirm, setConfirm] = useState(false);
  if (!card.closed)
    return (
      <SideButton
        icon="archive"
        onClick={() => update.mutate({ id: card.id, closed: true })}
      >
        Archive
      </SideButton>
    );
  return (
    <>
      <SideButton
        icon="back"
        onClick={() => update.mutate({ id: card.id, closed: false })}
      >
        Send to board
      </SideButton>
      {confirm ? (
        <SideButton
          icon="trash"
          className="bg-[#c9372c] text-white hover:bg-[#ae2e24]"
          onClick={() => del.mutate({ id: card.id })}
        >
          Confirm delete
        </SideButton>
      ) : (
        <SideButton
          icon="trash"
          className="bg-[#c9372c] text-white hover:bg-[#ae2e24]"
          onClick={() => setConfirm(true)}
        >
          Delete
        </SideButton>
      )}
    </>
  );
}

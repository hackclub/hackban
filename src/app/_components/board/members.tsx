"use client";

import { AnimatePresence, motion } from "framer-motion";
import { useRouter } from "next/navigation";
import { createContext, useContext, useEffect, useState } from "react";
import { createPortal } from "react-dom";

import { api } from "~/trpc/react";

import { Avatar, Button, Icon, IconButton, Popover, inputCls, usePopover } from "../ui";
import { type BoardData } from "./types";

type Member = BoardData["members"][number];
type Role = "admin" | "normal" | "observer";

export const ROLES: Record<Role, { label: string; desc: string }> = {
  admin: { label: "Admin", desc: "Can view, create and edit cards, change settings, and add or remove members." },
  normal: { label: "Member", desc: "Can view, create and edit cards, and change some board settings." },
  observer: { label: "Observer", desc: "Can view the board, but can't change anything." },
};

const roleLabel = (r: string) => ROLES[r as Role]?.label ?? r;

function useMemberActions(board: BoardData, meId: string) {
  const utils = api.useUtils();
  const router = useRouter();
  const inv = () => utils.board.get.invalidate({ id: board.id });
  const setRole = api.board.addMember.useMutation({
    onMutate: ({ userId, role }) =>
      utils.board.get.setData({ id: board.id }, (b) => b && { ...b, members: b.members.map((m) => (m.userId === userId ? { ...m, role: role! } : m)) }),
    onSettled: inv,
  });
  const remove = api.board.removeMember.useMutation({
    onMutate: ({ userId }) => utils.board.get.setData({ id: board.id }, (b) => b && { ...b, members: b.members.filter((m) => m.userId !== userId) }),
    onSettled: inv,
    onSuccess: (_d, v) => {
      // Leaving a private board means you can't see it anymore.
      if (v.userId === meId && board.visibility === "private") router.push("/");
    },
  });
  const error = setRole.error ?? remove.error;
  return { setRole, remove, error };
}

/** The face-pile in the board header. Each face opens Trello's member card. */
/** Board-level context for things deep in the tree (card avatars) that need the viewer or filters. */
export const BoardCtx = createContext<{ meId: string; filterMember: (userId: string) => void }>({
  meId: "",
  filterMember: () => undefined,
});

/** A card-front avatar that opens the same member card as the board header. */
export function CardMemberAvatar({ boardId, user }: { boardId: string; user: { id: string; name: string | null; image: string | null } }) {
  const { meId, filterMember } = useContext(BoardCtx);
  const [el, setEl] = useState<HTMLElement | null>(null);
  const { data: board } = api.board.get.useQuery({ id: boardId }, { enabled: !!el });
  const member = board?.members.find((m) => m.userId === user.id);
  return (
    <>
      <button
        type="button"
        onPointerDown={(e) => e.stopPropagation()}
        onClick={(e) => {
          e.stopPropagation();
          setEl(e.currentTarget);
        }}
        className="rounded-full transition-shadow hover:ring-2 hover:ring-[var(--color-focus)]"
        title={user.name ?? undefined}
        aria-label={`${user.name ?? "Member"} — member details`}
      >
        <Avatar user={user} size={24} />
      </button>
      <Popover anchor={el ? { el } : null} open={!!el && !!board} onClose={() => setEl(null)}>
        {board && member ? (
          <MemberCard
            board={board}
            member={member}
            meId={meId}
            onFilter={() => {
              filterMember(user.id);
              setEl(null);
            }}
          />
        ) : (
          <p className="py-2 text-sm text-[var(--color-text-subtle)]">{user.name} is no longer a member of this board.</p>
        )}
      </Popover>
    </>
  );
}

export function MemberAvatars({ board, meId, onFilterMember }: { board: BoardData; meId: string; onFilterMember: (userId: string) => void }) {
  const [open, setOpen] = useState<{ userId: string; el: HTMLElement } | null>(null);
  const [all, setAll] = useState<HTMLElement | null>(null);
  // Show yourself first, then admins, like Trello.
  const members = [...board.members].sort(
    (a, b) => Number(b.userId === meId) - Number(a.userId === meId) || Number(b.role === "admin") - Number(a.role === "admin"),
  );
  const shown = members.slice(0, 5);
  const member = board.members.find((m) => m.userId === open?.userId);

  return (
    <>
      <div className="flex items-center -space-x-1.5">
        {shown.map((m) => (
          <button
            key={m.userId}
            onClick={(e) => setOpen({ userId: m.userId, el: e.currentTarget })}
            className="relative rounded-full ring-2 ring-black/30 transition-shadow hover:z-10 hover:ring-white/70 focus-visible:z-10 focus-visible:ring-white"
            title={m.user.name ?? undefined}
          >
            <Avatar user={m.user} size={28} />
          </button>
        ))}
        {members.length > shown.length && (
          <button
            onClick={(e) => setAll(e.currentTarget)}
            className="relative flex h-7 w-7 items-center justify-center rounded-full bg-white/25 text-xs font-semibold text-white ring-2 ring-black/30 transition-colors hover:bg-white/40 hover:ring-white/70"
          >
            +{members.length - shown.length}
          </button>
        )}
      </div>

      <Popover anchor={open ? { el: open.el } : null} open={!!member} onClose={() => setOpen(null)}>
        {member && (
          <MemberCard
            board={board}
            member={member}
            meId={meId}
            onFilter={() => {
              onFilterMember(member.userId);
              setOpen(null);
            }}
          />
        )}
      </Popover>

      <Popover anchor={all ? { el: all } : null} open={!!all} onClose={() => setAll(null)} title="Board members">
        <div className="grid grid-cols-6 gap-1.5 pt-1">
          {members.map((m) => (
            <button
              key={m.userId}
              className="rounded-full transition-transform hover:scale-110"
              title={m.user.name ?? undefined}
              onClick={(e) => {
                setAll(null);
                setOpen({ userId: m.userId, el: e.currentTarget.closest("[data-popover]") ?? e.currentTarget });
              }}
            >
              <Avatar user={m.user} size={36} />
            </button>
          ))}
        </div>
      </Popover>
    </>
  );
}

/** Trello's member popover: big avatar header, then actions. */
export function MemberCard({ board, member, meId, onFilter }: { board: BoardData; member: Member; meId: string; onFilter: () => void }) {
  const pop = usePopover();
  const [pane, setPane] = useState<"main" | "role" | "remove">("main");
  const { setRole, remove, error } = useMemberActions(board, meId);
  const isAdmin = board.myRole === "admin";
  const self = member.userId === meId;

  if (pane === "role") {
    return (
      <div className="pt-2">
        <PaneHeader title="Change permissions" onBack={() => setPane("main")} />
        {(Object.keys(ROLES) as Role[]).map((r) => (
          <button
            key={r}
            disabled={!isAdmin}
            onClick={() => {
              setRole.mutate({ id: board.id, userId: member.userId, role: r });
              setPane("main");
            }}
            className="-mx-3 block w-[calc(100%+24px)] px-3 py-2 text-left transition-colors hover:bg-[var(--color-neutral)] disabled:opacity-50"
          >
            <span className="text-sm font-medium">
              {ROLES[r].label} {member.role === r && "✓"}
            </span>
            <span className="block text-xs text-[var(--color-text-subtle)]">{ROLES[r].desc}</span>
          </button>
        ))}
      </div>
    );
  }

  if (pane === "remove") {
    return (
      <div className="pt-2">
        <PaneHeader title={self ? "Leave board?" : "Remove member?"} onBack={() => setPane("main")} />
        <p className="mb-3 text-sm">
          {self
            ? "You'll be removed from all cards on this board."
            : `${member.user.name} will be removed from all cards on this board and will no longer be able to see it unless it's visible to their workspace.`}
        </p>
        <Button
          variant="danger"
          className="w-full"
          onClick={() => {
            remove.mutate({ id: board.id, userId: member.userId });
            pop.close();
          }}
        >
          {self ? "Leave board" : "Remove member"}
        </Button>
      </div>
    );
  }

  return (
    <div className="-mx-3 -mt-0">
      <div className="relative flex items-end gap-3 rounded-t-lg bg-[var(--color-brand)] px-3 pt-8 pb-3">
        <IconButton onClick={pop.close} className="absolute top-1 right-1 h-7 w-7 text-[var(--color-on-brand)] hover:bg-black/10" aria-label="Close">
          <Icon name="close" size={14} />
        </IconButton>
        <Avatar user={member.user} size={64} className="ring-4 ring-[var(--color-overlay)]" />
        <div className="min-w-0 pb-1 text-[var(--color-on-brand)]">
          <div className="truncate text-base font-semibold">{member.user.name}</div>
          <div className="truncate text-xs opacity-80">
            {member.user.isGhost ? "Imported from Trello" : member.user.username ? `@${member.user.username}` : roleLabel(member.role)}
          </div>
        </div>
      </div>
      <div className="px-3 pt-2">
        <MemberRow onClick={onFilter}>Filter cards by {self ? "me" : member.user.name?.split(" ")[0]}</MemberRow>
        {isAdmin ? (
          <MemberRow onClick={() => setPane("role")}>
            Change permissions… <span className="ml-auto text-xs text-[var(--color-text-subtle)]">({roleLabel(member.role)})</span>
          </MemberRow>
        ) : (
          <div className="py-1.5 text-sm text-[var(--color-text-subtle)]">Permissions: {roleLabel(member.role)}</div>
        )}
        {(isAdmin || self) && (
          <>
            <hr className="my-1.5 border-[var(--color-border)]" />
            <MemberRow danger onClick={() => setPane("remove")}>
              {self ? "Leave board…" : "Remove from board…"}
            </MemberRow>
          </>
        )}
        {error && <p className="pb-2 text-xs text-[var(--color-danger)]">{error.message === "FORBIDDEN" ? "Only board admins can do that." : error.message}</p>}
      </div>
    </div>
  );
}

function MemberRow({ children, onClick, danger }: { children: React.ReactNode; onClick: () => void; danger?: boolean }) {
  return (
    <button
      onClick={onClick}
      className={`-mx-3 flex w-[calc(100%+24px)] items-center px-3 py-1.5 text-left text-sm transition-colors hover:bg-[var(--color-neutral)] ${danger ? "text-[var(--color-danger)]" : ""}`}
    >
      {children}
    </button>
  );
}

function PaneHeader({ title, onBack }: { title: string; onBack: () => void }) {
  return (
    <div className="mb-2 grid grid-cols-[32px_1fr_32px] items-center">
      <IconButton onClick={onBack} aria-label="Back">
        <Icon name="back" />
      </IconButton>
      <h2 className="text-center text-sm font-semibold text-[var(--color-text-subtle)]">{title}</h2>
      <span />
    </div>
  );
}

/** Trello's centered "Share board" dialog. */
export function ShareDialog({ board, meId, open, onClose }: { board: BoardData; meId: string; open: boolean; onClose: () => void }) {
  const [q, setQ] = useState("");
  const [picked, setPicked] = useState<{ id: string; name: string | null; image: string | null }[]>([]);
  const [role, setNewRole] = useState<Role>("normal");
  const [copied, setCopied] = useState(false);
  const [roleFor, setRoleFor] = useState<{ userId: string; el: HTMLElement } | null>(null);
  const utils = api.useUtils();
  const { setRole, remove, error } = useMemberActions(board, meId);
  const { data: found } = api.board.searchUsers.useQuery({ q }, { enabled: open && q.length >= 2 });
  const add = api.board.addMember.useMutation({ onSettled: () => utils.board.get.invalidate({ id: board.id }) });
  const isAdmin = board.myRole === "admin";
  const candidates = (found ?? []).filter((u) => !board.members.some((m) => m.userId === u.id) && !picked.some((p) => p.id === u.id));
  const members = [...board.members].sort((a, b) => Number(b.userId === meId) - Number(a.userId === meId));
  const roleMember = board.members.find((m) => m.userId === roleFor?.userId);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && !document.querySelector("[data-popover]") && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  const share = async () => {
    for (const p of picked) await add.mutateAsync({ id: board.id, userId: p.id, role: isAdmin ? role : "normal" });
    setPicked([]);
    setQ("");
  };

  if (typeof document === "undefined") return null;
  return createPortal(
    <AnimatePresence>
      {open && (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.15 }}
          className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-black/60 px-2 pt-[10vh]"
          onMouseDown={(e) => e.target === e.currentTarget && onClose()}
        >
          <motion.div
            initial={{ opacity: 0, y: 16, scale: 0.98 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 16, scale: 0.98 }}
            transition={{ duration: 0.18, ease: [0.2, 0.9, 0.3, 1] }}
            className="w-[584px] max-w-full rounded-xl bg-[var(--color-overlay)] p-6 shadow-[var(--shadow-overlay)]"
          >
            <div className="mb-4 flex items-center justify-between">
              <h2 className="text-xl font-semibold">Share board</h2>
              <IconButton onClick={onClose} aria-label="Close"><Icon name="close" /></IconButton>
            </div>

            {board.myRole !== "observer" && (
              <div className="relative mb-4 flex gap-2">
                <div className={`${inputCls} flex flex-1 flex-wrap items-center gap-1 py-1`}>
                  {picked.map((p) => (
                    <span key={p.id} className="flex items-center gap-1 rounded-[3px] bg-[var(--color-neutral)] py-0.5 pr-1 pl-0.5 text-sm">
                      <Avatar user={p} size={20} /> {p.name}
                      <button onClick={() => setPicked(picked.filter((x) => x.id !== p.id))} aria-label="Remove">
                        <Icon name="close" size={12} />
                      </button>
                    </span>
                  ))}
                  <input
                    autoFocus
                    value={q}
                    onChange={(e) => setQ(e.target.value)}
                    placeholder={picked.length ? "" : "Email address or name"}
                    className="min-w-32 flex-1 bg-transparent py-1 outline-none"
                  />
                </div>
                {isAdmin && (
                  <select className="h-10 rounded-[3px] bg-[var(--color-neutral)] px-2 text-sm" value={role} onChange={(e) => setNewRole(e.target.value as Role)}>
                    {(Object.keys(ROLES) as Role[]).map((r) => <option key={r} value={r}>{ROLES[r].label}</option>)}
                  </select>
                )}
                <Button variant="primary" className="h-10" disabled={!picked.length || add.isPending} onClick={() => void share()}>
                  Share
                </Button>
                {q.length >= 2 && (
                  <div className="absolute top-12 right-0 left-0 z-10 max-h-64 overflow-y-auto rounded-lg bg-[var(--color-overlay)] py-1 shadow-[var(--shadow-overlay)]">
                    {candidates.map((u) => (
                      <button
                        key={u.id}
                        onClick={() => {
                          setPicked([...picked, u]);
                          setQ("");
                        }}
                        className="flex w-full items-center gap-2 px-3 py-1.5 text-left text-sm hover:bg-[var(--color-neutral)]"
                      >
                        <Avatar user={u} size={28} />
                        <span className="min-w-0">
                          <span className="block truncate">{u.name}</span>
                          <span className="block truncate text-xs text-[var(--color-text-subtlest)]">{u.isGhost ? "Imported from Trello" : u.email}</span>
                        </span>
                      </button>
                    ))}
                    {found && candidates.length === 0 && (
                      <p className="px-3 py-2 text-sm text-[var(--color-text-subtlest)]">
                        Nobody found. People need to log in to Hackban once before you can add them.
                      </p>
                    )}
                  </div>
                )}
              </div>
            )}

            <div className="mb-5 flex items-center gap-3">
              <span className="flex h-8 w-8 items-center justify-center rounded-[3px] bg-[var(--color-neutral)]"><Icon name="share" size={14} /></span>
              <div className="flex-1 text-sm">
                <div>Share this board with a link</div>
                <div className="text-xs text-[var(--color-text-subtle)]">
                  {board.visibility === "private" ? "Only board members can open it." : board.visibility === "public" ? "Anyone with the link can view it." : "Anyone in the workspace can open it."}
                </div>
              </div>
              <button
                className="text-sm font-medium text-[var(--color-brand)] hover:underline"
                onClick={() => {
                  void navigator.clipboard.writeText(`${window.location.origin}/b/${board.id}`);
                  setCopied(true);
                  setTimeout(() => setCopied(false), 1500);
                }}
              >
                {copied ? "Copied!" : "Copy link"}
              </button>
            </div>

            <h3 className="mb-2 border-b-2 border-[var(--color-brand)] pb-1 text-sm font-semibold text-[var(--color-brand)]">
              Board members <span className="ml-1 rounded-full bg-[var(--color-neutral)] px-1.5 text-xs text-[var(--color-text)]">{board.members.length}</span>
            </h3>
            {error && <p className="mb-2 text-sm text-[var(--color-danger)]">{error.message === "FORBIDDEN" ? "Only board admins can do that." : error.message}</p>}
            <div className="max-h-[40vh] overflow-y-auto">
              {members.map((m) => {
                const self = m.userId === meId;
                const canChange = isAdmin || self;
                return (
                  <div key={m.userId} className="flex items-center gap-3 py-2">
                    <Avatar user={m.user} size={32} />
                    <div className="min-w-0 flex-1">
                      <div className="truncate text-sm font-medium">
                        {m.user.name} {self && "(you)"}
                      </div>
                      <div className="truncate text-xs text-[var(--color-text-subtle)]">
                        {m.user.isGhost ? "Imported from Trello" : m.user.username ? `@${m.user.username}` : ""}
                        {m.role === "admin" && `${m.user.isGhost || m.user.username ? " • " : ""}Board admin`}
                      </div>
                    </div>
                    <button
                      disabled={!canChange}
                      onClick={(e) => setRoleFor({ userId: m.userId, el: e.currentTarget })}
                      className="flex h-8 items-center gap-1 rounded-[3px] bg-[var(--color-neutral)] px-3 text-sm font-medium hover:bg-[var(--color-neutral-hover)] disabled:cursor-default disabled:bg-transparent disabled:hover:bg-transparent"
                    >
                      {roleLabel(m.role)}
                      {canChange && (
                        <svg width="12" height="12" viewBox="0 0 24 24" fill="currentColor" aria-hidden><path d="M7 9l5 5 5-5z" /></svg>
                      )}
                    </button>
                  </div>
                );
              })}
            </div>
          </motion.div>
        </motion.div>
      )}
      <Popover key="role" anchor={roleFor ? { el: roleFor.el } : null} open={!!roleMember} onClose={() => setRoleFor(null)}>
        {roleMember && (
          <div className="pt-2">
            {isAdmin &&
              (Object.keys(ROLES) as Role[]).map((r) => (
                <button
                  key={r}
                  onClick={() => {
                    setRole.mutate({ id: board.id, userId: roleMember.userId, role: r });
                    setRoleFor(null);
                  }}
                  className="-mx-3 block w-[calc(100%+24px)] px-3 py-2 text-left transition-colors hover:bg-[var(--color-neutral)]"
                >
                  <span className="text-sm font-medium">{ROLES[r].label} {roleMember.role === r && "✓"}</span>
                  <span className="block text-xs text-[var(--color-text-subtle)]">{ROLES[r].desc}</span>
                </button>
              ))}
            <hr className="my-1 border-[var(--color-border)]" />
            <button
              onClick={() => {
                remove.mutate({ id: board.id, userId: roleMember.userId });
                setRoleFor(null);
              }}
              className="-mx-3 block w-[calc(100%+24px)] px-3 py-2 text-left text-sm text-[var(--color-danger)] transition-colors hover:bg-[var(--color-neutral)]"
            >
              {roleMember.userId === meId ? "Leave board" : "Remove from board"}
            </button>
          </div>
        )}
      </Popover>
    </AnimatePresence>,
    document.body,
  );
}

"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

import { api } from "~/trpc/react";

import { BOARD_COLORS, BOARD_GRADIENTS, Button, Popover, inputCls } from "./ui";

type Anchor = Parameters<typeof Popover>[0]["anchor"];

export function CreateBoardPopover({ anchor, onClose, workspaceId }: { anchor: Anchor; onClose: () => void; workspaceId?: string }) {
  const router = useRouter();
  const { data: workspaces } = api.workspace.list.useQuery(undefined, { enabled: !!anchor });
  const [name, setName] = useState("");
  const [bg, setBg] = useState(BOARD_GRADIENTS[0]!);
  const [ws, setWs] = useState<string | undefined>(workspaceId);
  const [visibility, setVisibility] = useState<"private" | "workspace" | "public">("workspace");
  const utils = api.useUtils();
  const create = api.board.create.useMutation({
    onSuccess: (b) => {
      void utils.workspace.list.invalidate();
      onClose();
      setName("");
      router.push(`/b/${b.id}`);
    },
  });
  const wsId = ws ?? workspaces?.[0]?.id;

  return (
    <Popover anchor={anchor} open={!!anchor} onClose={onClose} title="Create board">
      <div className="mx-auto mb-3 flex h-[120px] w-[200px] items-center justify-center rounded-[3px] p-2" style={{ background: bg }}>
        <svg width="186" height="103" viewBox="0 0 186 103" aria-hidden>
          <rect x="7" y="8" width="52" height="60" rx="3" fill="#fff" fillOpacity=".75" />
          <rect x="67" y="8" width="52" height="88" rx="3" fill="#fff" fillOpacity=".75" />
          <rect x="127" y="8" width="52" height="40" rx="3" fill="#fff" fillOpacity=".75" />
        </svg>
      </div>
      <label className="mb-1 block text-xs font-bold text-[var(--color-text-subtle)]">Background</label>
      <div className="mb-2 grid grid-cols-6 gap-1.5">
        {BOARD_GRADIENTS.map((g) => (
          <BgSwatch key={g} bg={g} active={bg === g} onClick={() => setBg(g)} />
        ))}
        {BOARD_COLORS.slice(0, 6).map((c) => (
          <BgSwatch key={c} bg={c} active={bg === c} onClick={() => setBg(c)} />
        ))}
      </div>
      <label className="mt-3 mb-1 block text-xs font-bold text-[var(--color-text-subtle)]">
        Board title <span className="text-[var(--color-danger)]">*</span>
      </label>
      <input
        autoFocus
        className={inputCls}
        value={name}
        onChange={(e) => setName(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter" && name.trim() && wsId) create.mutate({ name: name.trim(), workspaceId: wsId, background: bg, visibility });
        }}
      />
      {!name.trim() && <p className="mt-1 text-xs">👋 Board title is required</p>}
      <label className="mt-3 mb-1 block text-xs font-bold text-[var(--color-text-subtle)]">Workspace</label>
      <select className={inputCls} value={wsId} onChange={(e) => setWs(e.target.value)}>
        {workspaces?.map((w) => <option key={w.id} value={w.id}>{w.name}</option>)}
      </select>
      <label className="mt-3 mb-1 block text-xs font-bold text-[var(--color-text-subtle)]">Visibility</label>
      <select className={inputCls} value={visibility} onChange={(e) => setVisibility(e.target.value as typeof visibility)}>
        <option value="private">Private</option>
        <option value="workspace">Workspace</option>
        <option value="public">Public</option>
      </select>
      <Button
        variant="primary"
        className="mt-4 w-full"
        disabled={!name.trim() || !wsId || create.isPending}
        onClick={() => wsId && create.mutate({ name: name.trim(), workspaceId: wsId, background: bg, visibility })}
      >
        Create
      </Button>
    </Popover>
  );
}

function BgSwatch({ bg, active, onClick }: { bg: string; active: boolean; onClick: () => void }) {
  return (
    <button
      onClick={onClick}
      className="relative h-8 rounded-[3px] transition-transform hover:brightness-90"
      style={{ background: bg }}
      aria-label="Background"
    >
      {active && <span className="absolute inset-0 flex items-center justify-center text-white">✓</span>}
    </button>
  );
}

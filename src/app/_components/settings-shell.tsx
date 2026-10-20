"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, useState } from "react";

import { api } from "~/trpc/react";

import { Icon, WorkspaceLogo } from "./ui";

/**
 * Trello's full-screen settings surface: personal settings and a workspace
 * switcher on the left, the active page on the right, an X to close.
 */
export function SettingsShell({ workspaceId, children }: { workspaceId?: string; children: React.ReactNode }) {
  const pathname = usePathname();
  const router = useRouter();
  const { data: workspaces } = api.workspace.list.useQuery();
  const [collapsed, setCollapsed] = useState(false);
  const wsId = workspaceId ?? workspaces?.[0]?.id;
  const ws = workspaces?.find((w) => w.id === wsId);
  const wsTab = pathname.startsWith("/w/") ? (pathname.split("/")[3] ?? "") : "";

  // Esc / X leave settings entirely (not just back a page), like Trello.
  const close = () => router.push("/");
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement;
      if (e.key === "Escape" && !/INPUT|TEXTAREA|SELECT/.test(t.tagName) && !document.querySelector("[data-popover]")) close();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  });

  return (
    <div className="flex min-h-full bg-[var(--color-page)]">
      <aside
        className={`relative shrink-0 border-r border-[var(--color-border)] bg-[var(--color-modal)] transition-[width] duration-200 ease-out ${collapsed ? "w-4" : "w-[280px]"}`}
      >
        <button
          onClick={() => setCollapsed(!collapsed)}
          className="absolute top-8 -right-3.5 z-10 flex h-7 w-7 items-center justify-center rounded-full border border-[var(--color-border)] bg-[var(--color-overlay)] shadow-[var(--shadow-card)] hover:bg-[var(--color-surface-hover)]"
          aria-label={collapsed ? "Expand sidebar" : "Collapse sidebar"}
        >
          <Icon name="chevronLeft" size={14} className={`transition-transform ${collapsed ? "rotate-180" : ""}`} />
        </button>
        <div className={`sticky top-0 flex h-screen flex-col overflow-y-auto px-6 py-6 transition-opacity ${collapsed ? "pointer-events-none opacity-0" : "opacity-100"}`}>
          <h2 className="mb-2 px-2 text-sm font-semibold text-[var(--color-text-subtle)]">Personal Settings</h2>
          <NavLink href="/me" icon="profile" active={pathname === "/me"}>Profile and Visibility</NavLink>
          <NavLink href="/me/activity" icon="history" active={pathname === "/me/activity"}>Activity</NavLink>
          <NavLink href="/me/cards" icon="card" active={pathname === "/me/cards"}>Cards</NavLink>
          <NavLink href="/me/settings" icon="settings" active={pathname === "/me/settings"}>Settings</NavLink>

          <hr className="my-5 border-[var(--color-border)]" />

          <h2 className="mb-2 px-2 text-sm font-semibold text-[var(--color-text-subtle)]">Workspace</h2>
          <div className="relative mb-2">
            {ws && <WorkspaceLogo ws={ws} size={24} className="pointer-events-none absolute top-1/2 left-2.5 -translate-y-1/2" />}
            <select
              value={wsId ?? ""}
              onChange={(e) => router.push(`/w/${e.target.value}${wsTab ? `/${wsTab}` : ""}`)}
              className="h-10 w-full appearance-none rounded-[3px] bg-[var(--color-surface)] pr-8 pl-11 text-sm font-medium shadow-[inset_0_0_0_1px_var(--color-border)] outline-none focus:shadow-[inset_0_0_0_2px_var(--color-focus)]"
            >
              {workspaces?.map((w) => <option key={w.id} value={w.id}>{w.name}</option>)}
            </select>
            <Icon name="chevronDown" className="pointer-events-none absolute top-1/2 right-2.5 -translate-y-1/2" />
          </div>
          {wsId && (
            <>
              <NavLink href={`/w/${wsId}`} icon="board" active={pathname === `/w/${wsId}`}>Boards</NavLink>
              <NavLink href={`/w/${wsId}/members`} icon="people" active={wsTab === "members"}>Members</NavLink>
              <NavLink href={`/w/${wsId}/settings`} icon="settings" active={wsTab === "settings"}>Settings</NavLink>
              <NavLink href={`/w/${wsId}/export`} icon="download" active={wsTab === "export"}>Export</NavLink>
            </>
          )}
        </div>
      </aside>

      <main className="relative min-w-0 flex-1 px-6 py-8 md:px-12">
        <button
          onClick={close}
          className="absolute top-4 right-4 flex h-10 w-10 items-center justify-center rounded-full border border-[var(--color-border)] hover:bg-[var(--color-neutral)]"
          aria-label="Close settings"
        >
          <Icon name="close" />
        </button>
        <div key={pathname} className="animate-pop-in mx-auto max-w-[1100px]">{children}</div>
      </main>
    </div>
  );
}

function NavLink({ href, icon, active, children }: { href: string; icon: string; active: boolean; children: React.ReactNode }) {
  return (
    <Link
      href={href}
      className={`mb-0.5 flex h-10 items-center gap-3 rounded-[3px] px-3 text-sm font-medium transition-colors ${
        active
          ? "bg-[var(--color-brand-subtle)] text-[var(--color-brand)] shadow-[inset_0_0_0_1px_var(--color-brand)]"
          : "hover:bg-[var(--color-neutral)]"
      }`}
    >
      <Icon name={icon} />
      {children}
    </Link>
  );
}

export function PageTitle({ children, sub }: { children: React.ReactNode; sub?: React.ReactNode }) {
  return (
    <div className="mb-6">
      <h1 className="text-2xl font-semibold">{children}</h1>
      {sub && <p className="mt-1 text-sm text-[var(--color-text-subtle)]">{sub}</p>}
    </div>
  );
}

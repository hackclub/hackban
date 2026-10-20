import { notFound } from "next/navigation";

import { SettingsShell } from "~/app/_components/settings-shell";
import { WorkspacePage } from "~/app/_components/workspace-settings";
import { requireUser } from "~/server/auth/require";

const PAGES = { "": "boards", members: "members", settings: "settings", export: "export" } as const;

export default async function Page({ params }: { params: Promise<{ id: string; tab?: string[] }> }) {
  const { id, tab } = await params;
  const page = PAGES[(tab?.[0] ?? "") as keyof typeof PAGES];
  if (!page || (tab?.length ?? 0) > 1) notFound();
  const user = await requireUser(`/w/${id}${tab ? `/${tab[0]}` : ""}`);
  return (
    <SettingsShell workspaceId={id}>
      <WorkspacePage id={id} meId={user.id} page={page} />
    </SettingsShell>
  );
}

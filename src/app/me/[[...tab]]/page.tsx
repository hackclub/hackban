import { notFound } from "next/navigation";

import { PersonalPage } from "~/app/_components/personal-settings";
import { SettingsShell } from "~/app/_components/settings-shell";
import { requireUser } from "~/server/auth/require";

const PAGES = { "": "profile", activity: "activity", cards: "cards", settings: "settings" } as const;

export default async function Page({ params }: { params: Promise<{ tab?: string[] }> }) {
  const { tab } = await params;
  const page = PAGES[(tab?.[0] ?? "") as keyof typeof PAGES];
  if (!page || (tab?.length ?? 0) > 1) notFound();
  await requireUser(`/me${tab ? `/${tab[0]}` : ""}`);
  return (
    <SettingsShell>
      <PersonalPage page={page} />
    </SettingsShell>
  );
}

import { notFound } from "next/navigation";

import { AdminPanel } from "~/app/_components/admin-panel";
import { Header } from "~/app/_components/header";
import { requireUser } from "~/server/auth/require";

export default async function AdminPage() {
  const user = await requireUser("/admin");
  // Hide the panel's existence from non-admins.
  if (!user.isAdmin) notFound();
  return (
    <div className="flex min-h-full flex-col">
      <Header user={user} />
      <AdminPanel meId={user.id} />
    </div>
  );
}

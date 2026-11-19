import { redirect } from "next/navigation";
import { Portal } from "@/components/portal";
import {
  AdminElternkabine,
  AdminUnlock,
} from "@/components/elternkabine/admin";
import { profileSession, profileShell } from "@/lib/server/parent-profile";
import { adminUnlocked } from "@/lib/server/elternkabine";
import "@/components/elternkabine/elternkabine.css";
export const dynamic = "force-dynamic";
// Nur Super-Admins (Funktionsschalter-Recht) und nur mit zusätzlichem Passwort.
export default async function Page() {
  const session = await profileSession().catch(() => null);
  if (!session?.role) redirect("/login");
  if (session.role !== "admin") redirect("/");
  const { data } = await session.db.rpc("can_manage_features");
  if (data !== true) redirect("/admin");
  const unlocked = await adminUnlocked();
  return (
    <Portal initial={profileShell(session)} section="admin-elternkabine">
      {unlocked ? <AdminElternkabine /> : <AdminUnlock />}
    </Portal>
  );
}

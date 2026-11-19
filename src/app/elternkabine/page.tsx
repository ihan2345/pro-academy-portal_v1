import { redirect, notFound } from "next/navigation";
import { Portal } from "@/components/portal";
import { Elternkabine } from "@/components/elternkabine/elternkabine";
import { profileSession, profileShell } from "@/lib/server/parent-profile";
import { elternkabineFlags } from "@/lib/server/elternkabine";
import "@/components/elternkabine/elternkabine.css";
export const dynamic = "force-dynamic";
export default async function Page() {
  const session = await profileSession().catch(() => null);
  if (!session?.role) redirect("/login");
  const flags = await elternkabineFlags();
  const team = session.role === "admin" || session.role === "staff";
  // „Community aktivieren“ = nur Mitarbeiter; „Für Eltern veröffentlichen“ = auch Eltern.
  if (!flags.community) notFound();
  if (!team && (session.role !== "parent" || !flags.enabled)) notFound();
  return (
    <Portal initial={profileShell(session)} section="elternkabine">
      <Elternkabine />
    </Portal>
  );
}

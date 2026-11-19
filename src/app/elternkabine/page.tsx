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
  if (session.role !== "parent") redirect("/admin-elternkabine");
  if (!flags.enabled) notFound();
  return (
    <Portal initial={profileShell(session)} section="elternkabine">
      <Elternkabine />
    </Portal>
  );
}

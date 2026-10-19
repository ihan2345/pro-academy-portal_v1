import { paiEnabled } from "@/lib/server/pai/switch";
import { redirect, notFound } from "next/navigation";
import { sessionUser } from "@/lib/server/supabase";
import { profileShell } from "@/lib/server/parent-profile";
import { Portal } from "@/components/portal";
import { PaiAdmin } from "@/components/pai/admin";
export const dynamic = "force-dynamic";
export default async function Page() {
  if (!(await paiEnabled())) notFound();
  const s = await sessionUser();
  if (!s?.role) redirect("/login");
  if (s.role !== "admin") redirect("/pai");
  return (
    <Portal initial={profileShell(s)} section="admin/pai">
      <PaiAdmin />
    </Portal>
  );
}

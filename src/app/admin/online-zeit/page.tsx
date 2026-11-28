import { notFound, redirect } from "next/navigation";
import { featureManager } from "@/lib/server/platform-features";
import { HttpError } from "@/lib/server/security";
import { profileShell } from "@/lib/server/parent-profile";
import { Portal } from "@/components/portal";
import { OnlineTimeView } from "@/design-2026/online-time";
export const dynamic = "force-dynamic";
// Super-Admin-Ansicht: gesamte Online-Zeit je Konto als tt:hh:mm.
export default async function Page() {
  let s;
  try {
    s = await featureManager();
  } catch (e) {
    if (e instanceof HttpError && e.status === 401) redirect("/login");
    if (e instanceof HttpError && e.status === 403) notFound();
    throw e;
  }
  return (
    <Portal initial={profileShell(s)} section="admin/einstellungen">
      <OnlineTimeView />
    </Portal>
  );
}

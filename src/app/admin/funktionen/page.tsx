import { notFound, redirect } from "next/navigation";
import { featureManager } from "@/lib/server/platform-features";
import { HttpError } from "@/lib/server/security";
import { profileShell } from "@/lib/server/parent-profile";
import { Portal } from "@/components/portal";
import { PlatformFeatures } from "@/components/platform-features";
export const dynamic = "force-dynamic";
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
      <PlatformFeatures />
    </Portal>
  );
}

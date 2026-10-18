import { paiEnabled } from "@/lib/server/pai/switch";
import { redirect, notFound } from "next/navigation";
import { sessionUser } from "@/lib/server/supabase";
import { profileShell } from "@/lib/server/parent-profile";
import { Portal } from "@/components/portal";
import Link from "next/link";
import { PaiChat, PaiPreference } from "@/components/pai/chat";
export const metadata = { robots: { index: false, follow: false } };
export const dynamic = "force-dynamic";
export default async function Page() {
  if (!paiEnabled()) notFound();
  const s = await sessionUser();
  if (!s?.role) redirect("/login");
  return (
    <Portal initial={profileShell(s)} section="pai">
      <section className="panel pai-page">
        <h1>pAi</h1>
        <PaiChat role={s.role} />
        {s.role === "parent" && <PaiPreference />}
        {s.role === "admin" && <Link href="/admin/pai">pAi verwalten</Link>}
      </section>
    </Portal>
  );
}

import { notFound, redirect } from "next/navigation";
import { giftsEnabled } from "@/lib/gifts/runtime";
import { profileSession, profileShell } from "@/lib/server/parent-profile";
import { portalHome } from "@/lib/portal-access";
import { Portal } from "@/components/portal";
import { GiftAccountPage } from "@/components/products/gift-account";
import { productIdSchema } from "@/lib/products/domain";
export const dynamic = "force-dynamic";
export const metadata = {
  title: "Meine Geschenkkarten · ProAcademy",
  robots: { index: false, follow: false },
};
export default async function Page({
  params,
}: {
  params: Promise<{ card?: string[] }>;
}) {
  if (!giftsEnabled()) notFound();
  const s = await profileSession().catch(() => null);
  if (!s?.role) redirect("/login");
  if (s.role !== "parent") redirect(portalHome(s.role));
  const parts = (await params).card ?? [];
  if (
    parts.length > 1 ||
    (parts[0] && !productIdSchema.safeParse(parts[0]).success)
  )
    notFound();
  return (
    <Portal initial={profileShell(s)} section="profil">
      <GiftAccountPage id={parts[0]} />
    </Portal>
  );
}

import { notFound } from "next/navigation";
import { giftsEnabled } from "@/lib/gifts/runtime";
import { GiftStatusPage } from "@/components/products/gift-status";
export const dynamic = "force-dynamic";
export const metadata = {
  title: "Deine Geschenkkarte · ProAcademy",
  robots: { index: false, follow: false },
  referrer: "no-referrer",
};
export default function Page() {
  if (!giftsEnabled()) notFound();
  return <GiftStatusPage />;
}

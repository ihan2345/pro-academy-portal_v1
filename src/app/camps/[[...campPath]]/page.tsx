import { notFound } from "next/navigation";
import { campPageGuard } from "@/lib/camps/guard";
import { loadPortal } from "@/lib/server/data";
import { Portal } from "@/components/portal";
import { CampDashboard } from "@/components/camps/dashboard";
import { CampCustomerList } from "@/components/camps/customer-list";
import "@/components/camps/camps.css";
import { campLoginHref } from "@/lib/camps/runtime";
export const dynamic = "force-dynamic";
export default async function Page({
  params,
}: {
  params: Promise<{ campPath?: string[] }>;
}) {
  const { campPath = [] } = await params;
  const [campId, section] = campPath;
  if (
    campPath.length > 2 ||
    (campId &&
      !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(
        campId,
      )) ||
    (section && !["mitglieder", "pruefung", "kundenliste"].includes(section))
  )
    notFound();
  await campPageGuard();
  const portal = await loadPortal("konto");
  if (section === "kundenliste" && !["admin", "staff"].includes(portal.role))
    notFound();
  return (
    <Portal initial={portal} section="camps">
      {section === "kundenliste" ? (
        <CampCustomerList campId={campId} />
      ) : (
        <CampDashboard
          key={campPath.join("/")}
          campId={campId}
          view={
            section === "mitglieder" || section === "pruefung"
              ? section
              : "overview"
          }
          loginHref={campLoginHref()}
        />
      )}
    </Portal>
  );
}

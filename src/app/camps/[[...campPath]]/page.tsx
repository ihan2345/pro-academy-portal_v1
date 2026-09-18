import { notFound } from "next/navigation";
import { campPageGuard } from "@/lib/camps/guard";
import { loadPortal } from "@/lib/server/data";
import { Portal } from "@/components/portal";
import { CampDashboard } from "@/components/camps/dashboard";
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
    (section && section !== "mitglieder" && section !== "pruefung")
  )
    notFound();
  await campPageGuard();
  return (
    <Portal initial={await loadPortal("konto")} section="camps">
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
    </Portal>
  );
}

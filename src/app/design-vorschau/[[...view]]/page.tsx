// Design-Vorschau 2026 mit Beispieldaten. Nur aktiv mit DESIGN_PREVIEW=true,
// sonst 404. Nutzt dieselben Komponenten wie das echte Portal.
import { notFound } from "next/navigation";
import { Portal } from "@/components/portal";
import { CampDashboard } from "@/components/camps/dashboard";
import "@/components/camps/camps.css";
import { previewAdminPortal, previewPortal } from "@/design-2026/mock-data";
import { PreviewFetch } from "@/design-2026/preview-fetch";
export const dynamic = "force-dynamic";
export default async function Page({
  params,
}: {
  params: Promise<{ view?: string[] }>;
}) {
  if (process.env.DESIGN_PREVIEW !== "true") notFound();
  const view = (await params).view ?? [];
  const [section = "", campId] = view;
  const adminSections = [
    "",
    "spieler",
    "eltern",
    "standorte",
    "mitarbeiter",
    "trainingsplanung",
  ];
  if (section === "admin") {
    const sub = view.slice(1).join("/");
    if (!adminSections.includes(sub)) notFound();
    return (
      <>
        <PreviewFetch />
        <Portal
          initial={previewAdminPortal()}
          section={sub ? `admin/${sub}` : "admin"}
        />
      </>
    );
  }
  if (
    !["", "termine", "stempelkarte", "berichte", "konto", "camps"].includes(
      section,
    )
  )
    notFound();
  return (
    <>
      <PreviewFetch />
      {section === "camps" ? (
        <Portal initial={previewPortal()} section="camps">
          <CampDashboard campId={campId} view="overview" loginHref="/login" />
        </Portal>
      ) : (
        <Portal initial={previewPortal()} section={section} />
      )}
    </>
  );
}

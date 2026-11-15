// Design-Vorschau 2026 mit Beispieldaten. Nur aktiv mit DESIGN_PREVIEW=true,
// sonst 404. Nutzt dieselben Komponenten wie das echte Portal.
import { notFound } from "next/navigation";
import { Portal } from "@/components/portal";
import { CampDashboard } from "@/components/camps/dashboard";
import "@/components/camps/camps.css";
import { previewAdminPortal, previewPortal } from "@/design-2026/mock-data";
import { PreviewFetch } from "@/design-2026/preview-fetch";
import { previewFamily, previewPlayer } from "@/design-2026/mock-pages";
import { ProfileView } from "@/components/parent-profile";
import { PlayerCard } from "@/design-2026/player-card";
import { ProductStore } from "@/components/products/store";
import "@/components/products/products.css";
import { GiftAccountOverview } from "@/components/products/gift-account";
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
  if (section === "admin" && view[1] === "elternprofil")
    return (
      <>
        <PreviewFetch />
        <Portal initial={previewAdminPortal()} section="admin/elternprofile">
          <ProfileView
            initial={previewFamily("admin")}
            base="/design-vorschau/admin/eltern"
          />
        </Portal>
      </>
    );
  if (section === "admin" && view[1] === "spielerkarte")
    return (
      <>
        <PreviewFetch />
        <Portal initial={previewAdminPortal()} section="admin/spielerprofile">
          <PlayerCard
            player={previewPlayer()}
            team="U11"
            back="/design-vorschau/admin"
          />
        </Portal>
      </>
    );
  if (section === "profil" || section === "produkte")
    return (
      <>
        <PreviewFetch />
        <Portal initial={previewPortal()} section={section}>
          {section === "produkte" ? (
            <ProductStore embedded portalRole="parent" />
          ) : view[1] === "geschenkkarten" ? (
            <GiftAccountOverview />
          ) : (
            <ProfileView initial={previewFamily("parent")} base="/profil" />
          )}
        </Portal>
      </>
    );
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

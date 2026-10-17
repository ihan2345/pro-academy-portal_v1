import { Activities } from "@/components/activities";
import { PlayerProfiles } from "@/components/player-profiles";
import { ProfileList, ProfileView } from "@/components/parent-profile";
import {
  profileSession,
  profileShell,
  loadParentProfile,
} from "@/lib/server/parent-profile";
import { canOpenPortalSection, portalHome } from "@/lib/portal-access";
import { HttpError } from "@/lib/server/security";
import { redirect } from "next/navigation";
import { notFound } from "next/navigation";
import { loadPortal } from "@/lib/server/data";
import { Portal } from "@/components/portal";
export const dynamic = "force-dynamic";
const routes = [
  "",
  "termine",
  "stempelkarte",
  "berichte",
  "konto",
  "team",
  "team/stempelkarten",
  "admin",
  "admin/stempelkarten",
  "admin/trainingsplanung",
  "admin/spieler",
  "admin/eltern",
  "admin/mitarbeiter",
  "admin/standorte",
  "admin/produkte",
  "admin/produkte-berichte",
  "admin/stripe",
  "admin/einladungen",
  "admin/protokolle",
  "admin/einstellungen",
];
export default async function Page({
  params,
}: {
  params: Promise<{ section?: string[] }>;
}) {
  const section = (await params).section?.join("/") ?? "";
  if (/^(admin|team)\/aktivitaeten(\/alle)?$/.test(section)) {
    let session;
    try {
      session = await profileSession();
    } catch (e) {
      if (e instanceof HttpError && e.status === 401) redirect("/login");
      throw e;
    }
    if (!canOpenPortalSection(session.role!, section))
      redirect(portalHome(session.role!));
    const base = `/${section.split("/")[0]}/aktivitaeten`;
    return (
      <Portal initial={profileShell(session)} section={section}>
        <Activities base={base} all={section.endsWith("/alle")} />
      </Portal>
    );
  }
  if (/^(admin|team)\/spielerprofile$/.test(section)) {
    let session;
    try {
      session = await profileSession();
    } catch (e) {
      if (e instanceof HttpError && e.status === 401) redirect("/login");
      throw e;
    }
    if (!canOpenPortalSection(session.role!, section))
      redirect(portalHome(session.role!));
    return (
      <Portal initial={profileShell(session)} section={section}>
        <PlayerProfiles
          base={`/${section.split("/")[0]}/elternprofile`}
          admin={session.role === "admin"}
        />
      </Portal>
    );
  }
  const profileRoute =
    /^(?:(admin|team)\/elternprofile(?:\/([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})(\/einheiten)?)?|profil(\/einheiten)?)$/i.exec(
      section,
    );
  if (profileRoute) {
    let session;
    try {
      session = await profileSession();
    } catch (e) {
      if (e instanceof HttpError && e.status === 401) redirect("/login");
      throw e;
    }
    if (!canOpenPortalSection(session.role!, section))
      redirect(portalHome(session.role!));
    const base = profileRoute[1]
      ? `/${profileRoute[1]}/elternprofile`
      : "/profil";
    let content;
    try {
      content =
        profileRoute[1] && !profileRoute[2] ? (
          <ProfileList base={base} />
        ) : (
          <ProfileView
            key={`${session.role}:${section}`}
            initial={await loadParentProfile(session, profileRoute[2])}
            base={base}
            full={!!(profileRoute[3] || profileRoute[4])}
          />
        );
    } catch (e) {
      if (e instanceof HttpError && e.status === 404) notFound();
      if (!(e instanceof HttpError)) throw e;
      content = (
        <section className="panel">
          <h1>Elternprofil</h1>
          <p role="alert">{e.message}</p>
        </section>
      );
    }
    return (
      <Portal initial={profileShell(session)} section={section}>
        {content}
      </Portal>
    );
  }
  if (!routes.includes(section)) notFound();
  return <Portal initial={await loadPortal(section)} section={section} />;
}

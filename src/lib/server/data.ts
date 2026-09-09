import "server-only";
import { redirect } from "next/navigation";
import { demoData } from "../demo";
import type { PortalData, Training, Report } from "../types";
import { isDemo } from "./config";
import { sessionUser } from "./supabase";
import { periodLabel, disciplineStats } from "../domain";
import { canOpenPortalSection, portalHome } from "../portal-access";
export async function loadPortal(section: string): Promise<PortalData> {
  if (isDemo())
    return {
      ...demoData,
      role: section.startsWith("admin")
        ? "admin"
        : section.startsWith("team")
          ? "staff"
          : "parent",
    };
  const session = await sessionUser();
  if (!session?.role) redirect("/login");
  if (!canOpenPortalSection(session.role, section))
    redirect(portalHome(session.role));
  const { db } = session;
  const results = await Promise.all([
    db.from("players").select("*").is("archived_at", null),
    db
      .from("entitlement_periods")
      .select("*,subscriptions(status)")
      .order("starts_at", { ascending: false }),
    db
      .from("training_events")
      .select(
        "*,event_participants(*),locations(*),staff_profiles(*),event_private_notes(note)",
      )
      .order("starts_at", { ascending: false }),
    db
      .from("report_snapshots")
      .select("*")
      .order("created_at", { ascending: false }),
    db.from("locations").select("*").eq("active", true),
    db.from("staff_profiles").select("*").eq("active", true),
  ]);
  for (const result of results)
    if (result.error)
      throw new Error("Portaldaten konnten nicht geladen werden");
  const [players, periods, events, reports, locations, trainers] = results.map(
    (r) => r.data ?? [],
  );
  return {
    demo: false,
    role: session.role,
    user_name: session.name.split(" ")[0] || "Willkommen",
    email: session.user.email ?? "",
    players: players as PortalData["players"],
    periods: periods.map((p) => ({
      ...p,
      subscription_status: p.subscriptions?.status,
    })) as PortalData["periods"],
    events: events.map((e) => ({
      ...e,
      location_name: e.locations?.name ?? "",
      address: e.locations?.address ?? "",
      trainer_name: e.staff_profiles?.display_name ?? "",
      internal_note: e.event_private_notes?.note ?? "",
      participants: e.event_participants,
    })) as Training[],
    reports: reports.map((r) => ({
      id: r.id,
      player_id: r.player_id,
      period_id: r.period_id,
      version: r.version,
      created_at: r.created_at,
      product_name: r.snapshot.product_name,
      period_label: periodLabel(r.snapshot.starts_at, r.snapshot.ends_at),
      completed: r.snapshot.completed,
      units: r.snapshot.included_units,
      minutes: r.snapshot.minutes,
      athletics_units: r.snapshot.athletics_units ?? 0,
      football_completed: disciplineStats(r.snapshot.events ?? []).football
        .completed,
      athletics_completed: disciplineStats(r.snapshot.events ?? []).athletics
        .completed,
    })) as Report[],
    locations: locations as PortalData["locations"],
    trainers: trainers.map((t) => ({ id: t.id, name: t.display_name })),
    whatsapp: process.env.WHATSAPP_NUMBER ?? "",
  };
}

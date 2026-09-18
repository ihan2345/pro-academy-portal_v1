import "server-only";
import { campContext, childBenefit } from "../camps/service";
import { campEnabled, campLocalEnabled } from "../camps/guard";
import { campPaymentMode } from "../camps/runtime";
import { redirect } from "next/navigation";
import type { PortalData, Training, Report } from "../types";
import { sessionUser } from "./supabase";
import { periodLabel, disciplineStats, isRemovedParticipant } from "../domain";
import { canOpenPortalSection, portalHome } from "../portal-access";
export async function loadPortal(section: string): Promise<PortalData> {
  const session = await sessionUser();
  if (!session?.role) redirect("/login");
  if (!canOpenPortalSection(session.role, section))
    redirect(portalHome(session.role));
  const campsEnabled =
    campEnabled() &&
    (campLocalEnabled() ||
      campPaymentMode() === "live" ||
      ["staff", "admin"].includes(session.role));
  let campAccess: "active" | "past" | "only" | undefined;
  if (campsEnabled && session.role === "parent") {
    const context = await campContext();
    const benefits = await Promise.all(
      context.children.map((c) => childBenefit(c.id)),
    );
    campAccess = benefits.some((b) => b.group === "subscriber")
      ? "active"
      : benefits.some((b) => b.group === "former")
        ? "past"
        : "only";
    if (
      campAccess !== "active" &&
      (section === "" ||
        section === "stempelkarte" ||
        (campAccess === "only" && section === "termine"))
    )
      redirect("/camps");
  }
  const { db } = session;
  const results = await Promise.all([
    db
      .from("players")
      .select(session.role === "parent" ? "id,first_name,last_name,team" : "*")
      .is("archived_at", null),
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
    session.role === "parent"
      ? db
          .from("parent_stripe_customers")
          .select("stripe_customer_id")
          .order("created_at")
      : Promise.resolve({ data: [], error: null }),
  ]);
  for (const result of results)
    if (result.error)
      throw new Error("Portaldaten konnten nicht geladen werden");
  const [
    players,
    periods,
    events,
    reports,
    locations,
    trainers,
    billingCustomers,
  ] = results.map((r) => r.data ?? []);
  return {
    camp_enabled: campsEnabled,
    camp_access: campAccess,
    role: session.role,
    user_name: session.name.split(" ")[0] || "Willkommen",
    email: session.user.email ?? "",
    players: players as PortalData["players"],
    billing_customers: billingCustomers as PortalData["billing_customers"],
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
      participants: e.event_participants.filter(
        (p: Parameters<typeof isRemovedParticipant>[0]) =>
          !isRemovedParticipant(p),
      ),
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
      football_completed: disciplineStats(
        (r.snapshot.events ?? []).filter(
          (e: { status: string }) =>
            r.snapshot.attendance_policy === "charged_absences_v1" ||
            !["cancelled", "absent"].includes(e.status),
        ),
      ).football.completed,
      athletics_completed: disciplineStats(
        (r.snapshot.events ?? []).filter(
          (e: { status: string }) =>
            r.snapshot.attendance_policy === "charged_absences_v1" ||
            !["cancelled", "absent"].includes(e.status),
        ),
      ).athletics.completed,
    })) as Report[],
    locations: locations as PortalData["locations"],
    trainers: trainers.map((t) => ({ id: t.id, name: t.display_name })),
    whatsapp: process.env.WHATSAPP_NUMBER ?? "",
  };
}

import "server-only";
import { z } from "zod";
import { Temporal } from "@js-temporal/polyfill";
import type { ProfileSession } from "../parent-profile";
import { HttpError } from "../security";
import { serviceDb } from "../service-db";
import { checked } from "./service";

export const analyticsSchema = z
  .object({
    report: z.enum([
      "attendance",
      "trainers",
      "locations",
      "development",
      "subscriptions",
    ]),
    start: z.iso.date().nullable(),
    end: z.iso.date().nullable(),
  })
  .strict();
export function reportWindow(start: string | null, end: string | null) {
  const today = Temporal.Now.zonedDateTimeISO("Europe/Berlin").toPlainDate();
  const first = start ? Temporal.PlainDate.from(start) : today.with({ day: 1 });
  const last = end ? Temporal.PlainDate.from(end) : today;
  if (
    Temporal.PlainDate.compare(last, first) < 0 ||
    first.until(last).days > 731
  )
    throw new HttpError(
      400,
      "Bitte einen Zeitraum von höchstens zwei Jahren wählen.",
    );
  return {
    start: first.toString(),
    end: last.toString(),
    from: first.toZonedDateTime("Europe/Berlin").toInstant().toString(),
    until: last
      .add({ days: 1 })
      .toZonedDateTime("Europe/Berlin")
      .toInstant()
      .toString(),
  };
}
/** Full keyset traversal or failure; never label a partial page as a total. */
export async function collectRows(make: () => any): Promise<any[]> {
  const rows: any[] = [];
  let after: string | undefined;
  for (let page = 0; page < 40; page++) {
    let q = make().order("id").limit(250);
    if (after) q = q.gt("id", after);
    const batch = checked<any[] | null>(await q);
    rows.push(...batch);
    if (batch.length < 250) return rows;
    after = batch.at(-1).id;
  }
  throw new HttpError(
    503,
    "Auswertung zu groß. Bitte Zeitraum eingrenzen; keine Teilsumme berechnet.",
  );
}
export function attendanceReport(rows: any[], backfills: any[]) {
  const players = new Map<string, any>();
  const get = (r: any) => {
    if (!players.has(r.player_id))
      players.set(r.player_id, {
        name: `${r.players.first_name} ${r.players.last_name}`,
        attended: 0,
        absent: 0,
        excused: 0,
        cancelled: 0,
        pending: 0,
        minutes: 0,
      });
    return players.get(r.player_id)!;
  };
  for (const r of rows) {
    if (r.removed_from_event || r.training_events.status === "cancelled")
      continue;
    const p = get(r);
    if (["attended_auto", "attended_manual"].includes(r.status)) {
      p.attended++;
      p.minutes +=
        (Date.parse(r.training_events.ends_at) -
          Date.parse(r.training_events.starts_at)) /
        60000;
    } else if (["absent", "excused", "cancelled"].includes(r.status))
      p[r.status]++;
    else p.pending++;
  }
  for (const r of backfills) {
    const p = get(r);
    p.attended++;
    p.minutes += r.duration_minutes;
  }
  return [...players.values()].sort(
    (a, b) => b.absent - a.absent || a.name.localeCompare(b.name),
  );
}
export async function analytics(s: ProfileSession, raw: unknown) {
  const args = analyticsSchema.parse(raw);
  if (!["parent", "staff", "admin"].includes(s.role!))
    throw new HttpError(403, "Keine Berechtigung.");
  if (s.role === "parent" && ["trainers", "locations"].includes(args.report))
    throw new HttpError(403, "Academyweite Auswertung nur für das Team.");
  const window = reportWindow(args.start, args.end);
  const scope = s.role === "parent" ? "Eigene zugeordnete Kinder" : "Academy";
  // All queries use the authenticated session, including joins and family history.
  if (args.report === "subscriptions") {
    const links = await scopedSubscriptions(s);
    const active = new Set(
      links
        .filter((l) => l.subscriptions.status === "active")
        .map((l) => l.player_id),
    );
    const states: Record<string, number> = {};
    const subscriptions = new Map(
      links.map((l) => [l.subscriptions.id, l.subscriptions]),
    );
    for (const sub of subscriptions.values())
      states[sub.status] = (states[sub.status] ?? 0) + 1;
    return {
      scope,
      asOf: new Date().toISOString(),
      activeSubscriptionPlayers: active.size,
      subscriptionStates: states,
      note: "Aktueller synchronisierter Abozustand, kein historischer Stichtagsbestand. Ein Abo kann mehrere Kinder enthalten. Aktive Abos: Status active.",
      players: links.slice(0, 30).map((l) => ({
        name: `${l.players.first_name} ${l.players.last_name}`,
        status: l.subscriptions.status,
        synchronizedAt: l.subscriptions.synced_at,
      })),
      more: links.length > 30,
      totalsComplete: true,
    };
  }
  if (args.report === "attendance") {
    const rows = await collectRows(() =>
      s.db
        .from("event_participants")
        .select(
          "id,player_id,status,removed_from_event,players!inner(first_name,last_name),training_events!inner(starts_at,ends_at,status)",
        )
        .gte("training_events.starts_at", window.from)
        .lt("training_events.starts_at", window.until)
        .lt("training_events.ends_at", new Date().toISOString()),
    );
    const backfills = await collectRows(() =>
      s.db
        .from("training_backfills")
        .select(
          "id,player_id,duration_minutes,players!inner(first_name,last_name)",
        )
        .gte("occurred_on", window.start)
        .lte("occurred_on", window.end),
    );
    const undated =
      checked<any[] | null>(
        await s.db
          .from("training_backfills")
          .select("id")
          .is("occurred_on", null)
          .limit(1),
      ).length > 0;
    const report = attendanceReport(rows, backfills);
    const totals = report.reduce(
      (t, p) => {
        for (const k of Object.keys(t)) t[k] += p[k];
        return t;
      },
      {
        attended: 0,
        absent: 0,
        excused: 0,
        cancelled: 0,
        pending: 0,
        minutes: 0,
      } as Record<string, number>,
    );
    return {
      scope,
      window,
      totals,
      players: report.slice(0, 30),
      more: report.length > 30,
      totalsComplete: !undated,
      note: "Vergangene Teilnahmen; häufiges Fehlen = Status absent. Entschuldigt und abgesagte Teilnahme separat. Abgesagte Termine und entfernte Teilnehmer ausgeschlossen. Nachträge ohne Trainingsdatum können keinem Zeitraum zugeordnet werden.",
      undatedBackfillsExist: undated,
    };
  }
  const events = await collectRows(() =>
    s.db
      .from("training_events")
      .select(
        "id,starts_at,ends_at,status,trainer_id,location_id,staff_profiles(display_name),locations(name)",
      )
      .gte("starts_at", window.from)
      .lt("starts_at", window.until),
  );
  if (args.report === "development") {
    const players = await collectRows(() =>
      s.db.from("players").select("id,created_at,archived_at"),
    );
    const months = new Map<string, any>();
    const bucket = (date: string) => {
      const key = Temporal.Instant.from(date)
        .toZonedDateTimeISO("Europe/Berlin")
        .toPlainDate()
        .toString()
        .slice(0, 7);
      if (!months.has(key))
        months.set(key, {
          month: key,
          createdPlayers: 0,
          trainings: 0,
          trainingHours: 0,
        });
      return months.get(key);
    };
    for (const p of players)
      if (
        Date.parse(p.created_at) >= Date.parse(window.from) &&
        Date.parse(p.created_at) < Date.parse(window.until)
      )
        bucket(p.created_at).createdPlayers++;
    for (const e of events)
      if (e.status !== "cancelled" && Date.parse(e.ends_at) <= Date.now()) {
        const b = bucket(e.starts_at);
        b.trainings++;
        b.trainingHours +=
          (Date.parse(e.ends_at) - Date.parse(e.starts_at)) / 3600000;
      }
    return {
      scope,
      window,
      months: [...months.values()].sort((a, b) =>
        a.month.localeCompare(b.month),
      ),
      note: "Erfasste Spielerneuanlagen und vergangene, nicht abgesagte Termine. Anlagezeit ist kein Vertragsbeginn; Importdaten können Entwicklung verzerren. Keine historische Mitgliederbestandskurve.",
      complete: true,
    };
  }
  const groups = new Map<string, any>();
  for (const e of events) {
    if (e.status === "cancelled" || Date.parse(e.ends_at) > Date.now())
      continue;
    const id = args.report === "trainers" ? e.trainer_id : e.location_id;
    if (!groups.has(id))
      groups.set(id, {
        name:
          args.report === "trainers"
            ? (e.staff_profiles?.display_name ?? "Nicht zugeordnet")
            : (e.locations?.name ?? "Nicht zugeordnet"),
        trainings: 0,
        scheduledHours: 0,
      });
    const group = groups.get(id)!;
    group.trainings++;
    group.scheduledHours +=
      (Date.parse(e.ends_at) - Date.parse(e.starts_at)) / 3600000;
  }
  const ranked = [...groups.values()].sort(
    (a, b) => b.scheduledHours - a.scheduledHours,
  );
  return {
    scope,
    window,
    recordedTrainings: ranked.reduce((n, g) => n + g.trainings, 0),
    recordedCalendarHours: ranked.reduce((n, g) => n + g.scheduledHours, 0),
    groups: ranked.slice(0, 30),
    more: ranked.length > 30,
    totalsComplete: true,
    note:
      args.report === "trainers"
        ? "Vergangene, nicht abgesagte Termine laut Kalender. Planmäßige Dauer, kein Nachweis tatsächlich geleisteter Arbeitszeit; Nachträge zählen nicht als zusätzliche Trainertermine."
        : "Standortrangliste nach vergangenen Trainingsstunden. Prozentuale Kapazitätsauslastung nicht berechenbar: verfügbare Standortstunden/Plätze sind nicht gespeichert.",
  };
}

/** Subscription joins are not readable by parents/coaches under the legacy RLS.
 * First resolve the permitted players with session RLS, then project only those links. */
export async function scopedSubscriptions(s: ProfileSession): Promise<any[]> {
  if (!["parent", "staff", "admin"].includes(s.role!))
    throw new HttpError(403, "Keine Berechtigung.");
  const players = await collectRows(() =>
    s.db
      .from("players")
      .select("id,first_name,last_name")
      .is("archived_at", null),
  );
  const result: any[] = [];
  for (let offset = 0; offset < players.length; offset += 100) {
    const chunk = players.slice(offset, offset + 100);
    const links = await collectRows(() =>
      serviceDb()
        .from("subscription_players")
        .select(
          "id,player_id,subscriptions!inner(id,stripe_subscription_id,status,synced_at)",
        )
        .in(
          "player_id",
          chunk.map((p) => p.id),
        ),
    );
    for (const link of links)
      result.push({
        ...link,
        players: chunk.find((p) => p.id === link.player_id),
      });
  }
  return result;
}

export async function endingPeriods(s: ProfileSession, raw: unknown) {
  const args = z
    .object({
      start: z.iso.date().nullable(),
      end: z.iso.date().nullable(),
      offset: z.number().int().min(0).max(10000),
    })
    .strict()
    .parse(raw);
  if (!["parent", "staff", "admin"].includes(s.role!))
    throw new HttpError(403, "Keine Berechtigung.");
  const today = Temporal.Now.zonedDateTimeISO("Europe/Berlin").toPlainDate();
  const window = reportWindow(
    args.start ?? today.toString(),
    args.end ?? today.add({ days: 29 }).toString(),
  );
  const rows = await collectRows(() =>
    s.db
      .from("entitlement_periods")
      .select(
        "id,product_name,starts_at,ends_at,included_units,athletics_units,players!inner(first_name,last_name,archived_at)",
      )
      .eq("status", "active")
      .is("players.archived_at", null)
      .gte("ends_at", window.from)
      .lt("ends_at", window.until),
  );
  rows.sort(
    (a, b) =>
      Date.parse(a.ends_at) - Date.parse(b.ends_at) || a.id.localeCompare(b.id),
  );
  const periods = rows.slice(args.offset, args.offset + 30).map((p) => ({
    player: `${p.players.first_name} ${p.players.last_name}`,
    product: p.product_name,
    startsAt: p.starts_at,
    endsAt: p.ends_at,
    lastServiceDate: Temporal.Instant.from(p.ends_at)
      .subtract({ nanoseconds: 1 })
      .toZonedDateTimeISO("Europe/Berlin")
      .toPlainDate()
      .toString(),
    includedUnits: p.included_units,
    athleticsUnits: p.athletics_units,
  }));
  return {
    scope: s.role === "parent" ? "Eigene Kinder" : "Academy",
    window,
    total: rows.length,
    periods,
    more: args.offset + 30 < rows.length,
    nextOffset: args.offset + 30 < rows.length ? args.offset + 30 : null,
    totalsComplete: true,
    note: "Endende gültige Leistungszeiträume aus dem Portal, keine Abo-Kündigungen. endsAt ist die exklusive Endgrenze; lastServiceDate der letzte enthaltene Kalendertag in Europe/Berlin. Keine Aussage über automatische Verlängerung oder Restverbrauch. Bei mehr Treffern nächste Seite mit nextOffset abrufen oder den Auszug ausdrücklich benennen.",
  };
}

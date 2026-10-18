import "server-only";
import { z } from "zod";
import { type ProfileSession } from "../parent-profile";
import { checked, context, enabled, membership } from "./service";
import { serviceDb } from "../service-db";
import { HttpError } from "../security";
import { familyStatus } from "../../parent-profile";
import { attendanceStats, isRemovedParticipant } from "../../domain";
import { backfillEvent, backfillColumns } from "../../backfills";
import { campEnabled, campPaymentMode } from "../../camps/runtime";

import { analytics, collectRows } from "./analytics";
import { billing, subscriptionEndings } from "./billing";
const dateFields = {
  start: {
    type: ["string", "null"],
    description: "Erster Tag YYYY-MM-DD (Europe/Berlin), null für Standard.",
  },
  end: {
    type: ["string", "null"],
    description: "Letzter Tag YYYY-MM-DD einschließlich, null für Standard.",
  },
};
const schemas = {
  get_training_participants: {
    description:
      "Teilnehmer und tatsächlicher Anwesenheitsstatus der ausgewählten Trainings. Event-IDs aus get_training_history selbst auflösen; nie Nutzer nach IDs fragen. Eltern sehen ausschließlich eigene Kinder, Team alle berechtigten Teilnehmer. Geplant ist keine bestätigte Teilnahme.",
    fields: {
      event_ids: {
        type: "array",
        items: { type: "string" },
        minItems: 1,
        maxItems: 6,
      },
    },
  },
  get_subscription_endings: {
    description:
      "Explizit gekündigte Abos mit Endtermin und zugeordneten Kindern. Eltern nur eigene Kinder, Team academyweit. Standard nächste 30 Tage. Kein Finanzzugriff. Leistungszeitraumende ist keine Kündigung.",
    fields: dateFields,
  },
  get_portal_report: {
    description:
      "Vollständige Auswertungen: attendance = Anwesenheit/Fehlzeiten je Spieler inklusive datierter Nachträge; subscriptions = aktuelle Abozahlen; development = monatliche Spielerneuanlagen und Kalendertrainings. Eltern automatisch nur eigene Familie. trainers/locations nur Team: Kalenderstunden je Trainer/Standort. Zeitraum Standard laufender Monat; für Jahr explizite Daten setzen. Keine prozentuale Kapazitätsauslastung verfügbar.",
    fields: {
      report: {
        type: "string",
        enum: [
          "attendance",
          "trainers",
          "locations",
          "development",
          "subscriptions",
        ],
      },
      ...dateFields,
    },
  },
  get_billing_report: {
    description:
      "Admin academyweit, Eltern nur eigene Zahlungskonten: payments = Stripe-Zahlungseingänge im Zeitraum (Standard laufender Monat); unpaid = alle aktuell offenen Rechnungen; ending_subscriptions = ausdrücklich gekündigte/auslaufende Abos (Standard nächste 30 Tage). Nur lesen. Lokal keine Live-Finanzdaten.",
    fields: {
      report: {
        type: "string",
        enum: ["payments", "unpaid", "ending_subscriptions"],
      },
      ...dateFields,
    },
  },
  get_own_children: {
    description:
      "Eigene Kinder (Eltern) oder academyweite Spielersuche (Team). Höchstens 30 Treffer; bei mehr Treffern Suche eingrenzen.",
    fields: { search: { type: "string" } },
  },
  get_training_history: {
    description:
      "Trainings eines Spielers. Ohne player_id: Eltern alle eigenen Kinder; Trainer/Admin academyweite letzte und nächste Trainings. Bei allgemeinen Fragen null verwenden.",
    fields: { player_id: { type: ["string", "null"] } },
  },
  get_membership_badge: {
    description:
      "Belegtes Familienabzeichen und Statusmonate. Eltern ausschließlich eigene Familie; Team berechtigtes Elternprofil.",
    fields: { parent_id: { type: ["string", "null"] } },
  },
  get_subscription_summary: {
    description:
      "Verbleibende Trainingseinheiten und Leistungszeiträume. Eltern: player_id null liefert automatisch ALLE eigenen Kinder; niemals nach bereits zugeordneten Kindern fragen. Team: Spieler zuerst suchen.",
    fields: { player_id: { type: ["string", "null"] } },
  },
  get_pai_usage: {
    description: "Eigenes pAi-Kontingent mit Berechnung und Reset.",
    fields: {},
  },
  get_camp_summary: {
    description:
      "Campteilnahmen. Eltern: player_id null berücksichtigt alle eigenen Kinder. Team: konkreten Spieler suchen. Keine Zahlungs- oder Kontaktdaten.",
    fields: { player_id: { type: ["string", "null"] } },
  },
  get_admin_statistics: {
    description:
      "Nur Admin: aktuelle Anzahl aktiver Spieler und Trainings, keine personenbezogenen Finanzdaten.",
    fields: {},
  },
};
export function toolDefinitions(role: string) {
  return Object.entries(schemas)
    .filter(
      ([name]) =>
        (role === "admin" || name !== "get_admin_statistics") &&
        (["admin", "parent"].includes(role) || name !== "get_billing_report"),
    )
    .map(([name, spec]) => ({
      type: "function",
      name,
      description: spec.description,
      strict: true,
      parameters: {
        type: "object",
        properties: spec.fields,
        required: Object.keys(spec.fields),
        additionalProperties: false,
      },
    }));
}
async function player(s: ProfileSession, id: string) {
  z.uuid().parse(id);
  // Session client keeps existing RLS (parents own children, staff academy-wide).
  const row = checked(
    await s.db
      .from("players")
      .select("id")
      .eq("id", id)
      .is("archived_at", null)
      .maybeSingle(),
  );
  if (!row) throw new HttpError(403, "Spieler nicht verfügbar.");
}
export async function executeTool(
  s: ProfileSession,
  name: string,
  raw: unknown,
): Promise<any> {
  if (!(await enabled(s))) throw new HttpError(403, "pAi ist deaktiviert.");
  if (!toolDefinitions(s.role!).some((t) => t.name === name))
    throw new HttpError(403, "Werkzeug nicht erlaubt.");
  if (name === "get_training_participants") {
    const { event_ids } = z
      .object({ event_ids: z.array(z.uuid()).min(1).max(6) })
      .strict()
      .parse(raw);
    const events = checked(
      await s.db
        .from("training_events")
        .select("id,title,starts_at,ends_at,status,locations(name)")
        .in("id", [...new Set(event_ids)]),
    );
    if (events.length !== new Set(event_ids).size)
      throw new HttpError(403, "Training nicht verfügbar.");
    const ownChildren =
      s.role === "parent"
        ? await collectRows(() =>
            s.db.from("players").select("id").is("archived_at", null),
          )
        : null;
    const result = [];
    for (const event of events) {
      const rows =
        ownChildren?.length === 0
          ? []
          : await collectRows(() => {
              let q = s.db
                .from("event_participants")
                .select(
                  "id,status,removed_from_event,players!inner(first_name,last_name)",
                )
                .eq("event_id", event.id);
              if (ownChildren)
                q = q.in(
                  "player_id",
                  ownChildren.map((p) => p.id),
                );
              return q;
            });
      const visible = rows.filter((r) => !isRemovedParticipant(r as any));
      const counts: Record<string, number> = {};
      for (const row of visible)
        counts[row.status] = (counts[row.status] ?? 0) + 1;
      result.push({
        event,
        counts,
        participants: visible
          .slice(0, 60)
          .map((r) => ({
            name: `${r.players.first_name} ${r.players.last_name}`,
            status: r.status,
          })),
        more: visible.length > 60,
      });
    }
    return {
      scope:
        s.role === "parent"
          ? "Nur eigene Kinder; keine vollständige Gruppenliste"
          : "Academy",
      trainings: result,
      note: "attended_auto/attended_manual = Teilnahme erfasst; planned = nur eingeplant, absent = gefehlt, excused = entschuldigt, cancelled = Teilnahme abgesagt. Bei abgesagtem Training keine tatsächliche Durchführung behaupten. Entfernte Teilnehmer sind ausgeschlossen.",
    };
  }
  if (name === "get_subscription_endings") return subscriptionEndings(s, raw);
  if (name === "get_portal_report") return analytics(s, raw);
  if (name === "get_billing_report") return billing(s, raw);
  if (name === "get_own_children") {
    const { search } = z
      .object({ search: z.string().max(80) })
      .strict()
      .parse(raw);
    let q = s.db
      .from("players")
      .select("id,first_name,last_name,team")
      .is("archived_at", null)
      .order("id")
      .limit(31);
    const term = search.replace(/[^\p{L}\p{N} -]/gu, "").trim();
    for (const word of term.split(/\s+/).filter(Boolean))
      q = q.or(`first_name.ilike.%${word}%,last_name.ilike.%${word}%`);
    const rows = checked(await q);
    const visible = rows.slice(0, 30);
    const links =
      s.role !== "parent" && visible.length
        ? checked(
            await serviceDb()
              .from("parent_players")
              .select("player_id,parent_id")
              .in(
                "player_id",
                visible.map((p) => p.id),
              ),
          )
        : [];
    return {
      players: visible.map((p) => ({
        ...p,
        ...(s.role !== "parent"
          ? {
              parent_id:
                links.find((l) => l.player_id === p.id)?.parent_id ?? null,
            }
          : {}),
      })),
      more: rows.length > 30,
    };
  }
  if (name === "get_membership_badge") {
    const { parent_id } = z
      .object({ parent_id: z.uuid().nullable() })
      .strict()
      .parse(raw);
    const p = await membership(s, parent_id ?? undefined);
    return {
      badge: familyStatus(p.months),
      months: p.months,
      earned: p.earned_months,
      deducted: p.deducted_months,
      explanation: p.explanation,
    };
  }
  if (name === "get_pai_usage") {
    z.object({}).strict().parse(raw);
    const status = (await context(s)).status;
    return {
      ...status,
      resetBerlin: new Date(status.reset).toLocaleString("de-DE", {
        timeZone: "Europe/Berlin",
      }),
      timezone: "Europe/Berlin",
      complete: true,
      note: "Die laufende Frage ist reserviert und wird erst mit dieser Antwort als verwendet gebucht.",
    };
  }
  if (name === "get_admin_statistics") {
    z.object({}).strict().parse(raw);
    if (s.role !== "admin") throw new HttpError(403, "Keine Berechtigung.");
    const [players, trainings] = await Promise.all([
      s.db
        .from("players")
        .select("id", { count: "exact", head: true })
        .is("archived_at", null),
      s.db.from("training_events").select("id", { count: "exact", head: true }),
    ]);
    if (players.error || trainings.error)
      throw new HttpError(503, "Statistik nicht verfügbar.");
    return { activePlayers: players.count, trainingRecords: trainings.count };
  }
  const { player_id } = z
    .object({ player_id: z.uuid().nullable() })
    .strict()
    .parse(raw);
  if (!player_id) {
    if (s.role === "parent") {
      const family = await executeTool(s, "get_own_children", { search: "" });
      if (family.more)
        throw new HttpError(503, "Familie nicht vollständig abrufbar.");
      const children = [];
      for (const child of family.players) {
        try {
          children.push({
            name: `${child.first_name} ${child.last_name}`,
            data: await executeTool(s, name, { player_id: child.id }),
          });
        } catch {
          children.push({
            name: `${child.first_name} ${child.last_name}`,
            error:
              "Daten für dieses Kind derzeit nicht verfügbar; keine Werte schätzen.",
          });
        }
      }
      if (children.length && children.every((child) => "error" in child))
        throw new HttpError(503, "Familiendaten derzeit nicht verfügbar.");
      return {
        scope: "Eigene Familie",
        children,
        complete: !children.some((child) => "error" in child),
      };
    }
    if (name === "get_training_history") {
      const now = new Date().toISOString();
      const columns = "id,title,starts_at,ends_at,status,locations(name)";
      const [past, upcoming] = await Promise.all([
        s.db
          .from("training_events")
          .select(columns)
          .neq("status", "cancelled")
          .lte("ends_at", now)
          .order("ends_at", { ascending: false })
          .limit(6),
        s.db
          .from("training_events")
          .select(columns)
          .neq("status", "cancelled")
          .gte("starts_at", now)
          .order("starts_at")
          .limit(6),
      ]);
      return {
        scope: "Academy",
        recent: checked(past),
        upcoming: checked(upcoming),
        complete: false,
        note: "Jeweils bis zu sechs vergangene und kommende Trainings; keine Gesamtstatistik.",
      };
    }
    return {
      needs_player_search: true,
      instruction:
        "Mit get_own_children nach dem genannten Spieler suchen; bei allgemeinen Fragen eine Übersicht anbieten.",
    };
  }
  await player(s, player_id);
  if (name === "get_training_history") {
    const rows = checked(
      await s.db
        .from("event_participants")
        .select(
          "id,status,reason,removed_from_event,training_events!inner(id,title,starts_at,ends_at,status,locations(name))",
        )
        .eq("player_id", player_id)
        .order("starts_at", {
          referencedTable: "training_events",
          ascending: false,
        })
        .limit(41),
    );
    return {
      complete: false,
      note: "Begrenzter Auszug; keine Gesamtstatistik.",
      events: rows
        .filter((r) => !isRemovedParticipant(r as any))
        .slice(0, 40)
        .map((r) => ({ status: r.status, event: r.training_events })),
    };
  }
  if (name === "get_subscription_summary") {
    const now = new Date().toISOString();
    const periods = checked(
      await s.db
        .from("entitlement_periods")
        .select(
          "id,product_name,starts_at,ends_at,included_units,athletics_units",
        )
        .eq("player_id", player_id)
        .eq("status", "active")
        .lte("starts_at", now)
        .gt("ends_at", now)
        .limit(11),
    );
    if (periods.length > 10)
      throw new HttpError(503, "Zu viele Leistungszeiträume.");
    return Promise.all(
      periods.map(async (p) => {
        const events = checked(
          await s.db
            .from("event_participants")
            .select(
              "status,reason,removed_from_event,training_events!inner(starts_at,ends_at,status)",
            )
            .eq("player_id", player_id)
            .eq("period_id", p.id)
            .limit(501),
        );
        const backfills = checked(
          await s.db
            .from("training_backfills")
            .select(backfillColumns)
            .eq("player_id", player_id)
            .eq("period_id", p.id)
            .limit(501),
        );
        if (events.length > 500 || backfills.length > 500)
          throw new HttpError(503, "Kontingent nicht vollständig abrufbar.");
        const stats = attendanceStats([
          ...events
            .filter((r) => !isRemovedParticipant(r as any))
            .map((r: any) => ({
              ...r.training_events,
              status: r.status,
              event_cancelled: r.training_events.status === "cancelled",
            })),
          ...backfills.map((b: any) => backfillEvent(b)),
        ]);
        return {
          ...p,
          used: stats.completed,
          remaining: Math.max(0, p.included_units - stats.completed),
          minutes: stats.minutes,
        };
      }),
    );
  }
  if (!campEnabled()) return { available: false };
  let query = serviceDb()
    .from("camp_bookings")
    .select("attendance_status,camps!inner(title,payment_mode)")
    .eq("player_id", player_id)
    .eq("camps.payment_mode", campPaymentMode())
    .limit(31);
  if (s.role === "parent") {
    const owner = checked(
      await s.db
        .from("parents")
        .select("id")
        .eq("auth_user_id", s.user.id)
        .is("archived_at", null)
        .single(),
    );
    query = query.eq("parent_id", owner.id);
  }
  const rows = checked(await query);
  return { bookings: rows.slice(0, 30), more: rows.length > 30 };
}

// Probetraining-Ereignisse für die Glocke. Rein lesend: abgeleitet aus den
// bestehenden Probetraining-Tabellen, Mail-Aufträgen und dem Audit-Protokoll.
// Diese Datei enthält nur die reine Ableitung, damit sie ohne Datenbank
// getestet werden kann. Gelesen wird in server.ts (trialBellData).

export type TrialBellKind =
  | "request"
  | "planned"
  | "past"
  | "attended"
  | "absent"
  | "excused"
  | "closed"
  | "feedback"
  | "mail_sent"
  | "mail_failed"
  | "rating"
  | "comment"
  | "day7"
  | "day14"
  | "followup_failed"
  | "unsubscribed"
  | "converted";

export type TrialBellEvent = {
  /** Eindeutig je Ereignis. */
  id: string;
  kind: TrialBellKind;
  at: string;
  requestId: string | null;
  /** Kind (Vor- und Nachname) oder bei Familien-Ereignissen alle Kinder. */
  child: string;
  parent: string;
  /** Wartet das Ereignis noch auf das Team (z. B. Anfrage ohne Kontakt)? */
  open?: boolean;
  rating?: number;
  comment?: string;
  eventTitle?: string;
  startsAt?: string;
  /** Spielerprofil nach Abo-Übernahme. */
  playerId?: string;
  /** Tag 7 oder Tag 14 bei Folge-Mails. */
  day?: 7 | 14;
};

export type TrialBellRow = {
  id: string;
  family_id: string;
  first_name: string;
  last_name: string;
  parent_name: string;
  status: string;
  created_at: string;
  scheduled_at?: string | null;
  confirmed_at?: string | null;
  feedback_at?: string | null;
  converted_at?: string | null;
  converted_player_id?: string | null;
  event_title?: string | null;
  starts_at?: string | null;
  attendance?: string | null;
};
export type TrialBellInput = {
  rows: TrialBellRow[];
  feedback: {
    request_id: string;
    rating: number;
    feedback: string | null;
    created_at: string;
    comment_submitted_at: string | null;
  }[];
  mails: {
    id: string;
    kind: string;
    status: string;
    updated_at: string;
    payload: { request_id?: string; family_id?: string } | null;
  }[];
  audits: {
    id: string;
    table_name: string;
    record_id: string;
    created_at: string;
    old_value: Record<string, unknown> | null;
    new_value: Record<string, unknown> | null;
  }[];
  families: {
    id: string;
    parent_name: string;
    marketing_stopped_at: string | null;
  }[];
};

export const TRIAL_BELL_DAYS = 30;
const MINUTE = 60000;
const snippet = (s: string | null | undefined, n = 140) => {
  const t = (s ?? "").replace(/\s+/g, " ").trim();
  return t.length > n ? `${t.slice(0, n - 1).trimEnd()}…` : t;
};

export function buildTrialBellEvents(
  input: TrialBellInput,
  now: number,
): TrialBellEvent[] {
  const since = now - TRIAL_BELL_DAYS * 24 * 60 * MINUTE;
  const recent = (iso: string | null | undefined): iso is string =>
    !!iso && Date.parse(iso) >= since && Date.parse(iso) <= now + MINUTE;
  const byId = new Map(input.rows.map((r) => [r.id, r]));
  const name = (r: TrialBellRow) => `${r.first_name} ${r.last_name}`.trim();
  const family = (id: string) => {
    const kids = input.rows.filter((r) => r.family_id === id);
    const f = input.families.find((x) => x.id === id);
    return {
      parent: f?.parent_name || kids[0]?.parent_name || "Familie",
      child: kids.map(name).join(", ") || "Probetraining-Familie",
    };
  };
  const out: TrialBellEvent[] = [];
  const base = (r: TrialBellRow) => ({
    requestId: r.id,
    child: name(r),
    parent: r.parent_name,
  });

  for (const r of input.rows) {
    if (recent(r.created_at))
      out.push({
        ...base(r),
        id: `request:${r.id}`,
        kind: "request",
        at: r.created_at,
        open: r.status === "new" && !r.converted_at,
      });
    const past =
      !!r.scheduled_at &&
      !!r.starts_at &&
      Date.parse(r.starts_at) < Date.parse(r.scheduled_at);
    if (recent(r.scheduled_at))
      out.push({
        ...base(r),
        id: `${past ? "past" : "planned"}:${r.id}:${r.scheduled_at}`,
        kind: past ? "past" : "planned",
        at: r.scheduled_at,
        eventTitle: r.event_title ?? undefined,
        startsAt: r.starts_at ?? undefined,
      });
    // Rückwirkend eingetragen bestätigt die Teilnahme im selben Schritt.
    const sameStep =
      past &&
      !!r.confirmed_at &&
      Math.abs(Date.parse(r.confirmed_at) - Date.parse(r.scheduled_at!)) <
        5 * MINUTE;
    if (
      recent(r.confirmed_at) &&
      r.attendance === "attended_manual" &&
      !sameStep
    )
      out.push({
        ...base(r),
        id: `attended:${r.id}:${r.confirmed_at}`,
        kind: "attended",
        at: r.confirmed_at,
        eventTitle: r.event_title ?? undefined,
      });
    if (recent(r.feedback_at))
      out.push({
        ...base(r),
        id: `feedback:${r.id}:${r.feedback_at}`,
        kind: "feedback",
        at: r.feedback_at,
      });
    if (recent(r.converted_at))
      out.push({
        ...base(r),
        id: `converted:${r.id}`,
        kind: "converted",
        at: r.converted_at,
        playerId: r.converted_player_id ?? undefined,
      });
  }

  for (const f of input.feedback) {
    const r = byId.get(f.request_id);
    if (!r) continue;
    if (recent(f.created_at))
      out.push({
        ...base(r),
        id: `rating:${f.request_id}:${f.created_at}`,
        kind: "rating",
        at: f.created_at,
        rating: f.rating,
        comment: snippet(f.feedback) || undefined,
        open: f.rating <= 2,
      });
    // Später nachgereichter Kommentar (Sterne kamen vorher ohne Text).
    if (
      recent(f.comment_submitted_at) &&
      Date.parse(f.comment_submitted_at) - Date.parse(f.created_at) > MINUTE
    )
      out.push({
        ...base(r),
        id: `comment:${f.request_id}:${f.comment_submitted_at}`,
        kind: "comment",
        at: f.comment_submitted_at,
        rating: f.rating,
        comment: snippet(f.feedback) || undefined,
      });
  }

  for (const m of input.mails) {
    if (!recent(m.updated_at)) continue;
    const sent = m.status === "sent";
    if (m.kind === "trial_feedback") {
      const r = byId.get(m.payload?.request_id ?? "");
      if (!r) continue;
      out.push({
        ...base(r),
        id: `mail:${m.id}:${m.status}`,
        kind: sent ? "mail_sent" : "mail_failed",
        at: m.updated_at,
        open: !sent,
      });
    } else if (m.kind === "trial_day7" || m.kind === "trial_day14") {
      const fid = m.payload?.family_id;
      if (!fid) continue;
      out.push({
        ...family(fid),
        id: `followup:${m.id}:${m.status}`,
        kind: sent
          ? m.kind === "trial_day7"
            ? "day7"
            : "day14"
          : "followup_failed",
        day: m.kind === "trial_day7" ? 7 : 14,
        requestId: input.rows.find((r) => r.family_id === fid)?.id ?? null,
        at: m.updated_at,
        open: !sent,
      });
    }
  }

  for (const a of input.audits) {
    if (!recent(a.created_at)) continue;
    const next = a.new_value ?? {};
    const prev = a.old_value ?? {};
    if (a.table_name === "event_participants") {
      const r = byId.get(String(next.trial_request_id ?? ""));
      const status = String(next.status ?? "");
      if (
        !r ||
        !["absent", "excused"].includes(status) ||
        prev.status === status ||
        next.removed_from_event === true
      )
        continue;
      out.push({
        ...base(r),
        id: `attendance:${a.id}`,
        kind: status === "absent" ? "absent" : "excused",
        at: a.created_at,
        eventTitle: r.event_title ?? undefined,
      });
    } else if (a.table_name === "trial_requests") {
      const r = byId.get(a.record_id);
      if (!r || next.status !== "closed" || prev.status === "closed") continue;
      out.push({
        ...base(r),
        id: `closed:${a.id}`,
        kind: "closed",
        at: a.created_at,
      });
    }
  }

  for (const f of input.families)
    if (recent(f.marketing_stopped_at))
      out.push({
        ...family(f.id),
        id: `unsubscribed:${f.id}:${f.marketing_stopped_at}`,
        kind: "unsubscribed",
        requestId: input.rows.find((r) => r.family_id === f.id)?.id ?? null,
        at: f.marketing_stopped_at,
      });

  return out.sort((a, b) => Date.parse(b.at) - Date.parse(a.at));
}

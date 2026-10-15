import { Temporal } from "@js-temporal/polyfill";
import {
  TIMEZONE,
  isAttended,
  isRemovedParticipant,
  durationMinutes,
  type Attendance,
} from "./domain";
import { calendarDate } from "./calendar";

export const PROFILE_WEEK = 7 * 24 * 60 * 60 * 1000;
export type ProfileWindow = "month" | "all";
export interface ProfilePeriod {
  subscription_id?: string;
  player_id: string;
  starts_at: string;
  ends_at: string;
  status: string;
  product_name: string;
}
export interface ProfileUnit {
  id: string;
  player_id: string;
  child_name: string;
  title: string;
  event_type: string;
  starts_at: string | null;
  ends_at: string | null;
  day: string | null;
  status: Attendance;
  cancelled: boolean;
  minutes: number;
  retrospective: boolean;
  location: string;
}
export interface ProfileChild {
  gender?: "männlich" | "weiblich" | "divers" | null;
  club?: string | null;
  position?: string | null;
  strong_foot?: "rechts" | "links" | "beidfüßig" | null;
  height_cm?: number | null;
  development_goals?: string | null;
  first_name: string;
  last_name: string;
  birth_year: number | null;
  team: string;
  id: string;
  name: string;
  age: string;
  archived: boolean;
  products: string[];
  since: string | null;
  months: number;
  camps: number | null;
  stats: {
    month: { count: number; minutes: number };
    all: { count: number; minutes: number };
  };
}
export interface ParentProfile {
  id: string;
  name: string;
  email: string;
  phone: string | null;
  city: string | null;
  next_edit_at: string | null;
  role: "parent" | "staff" | "admin";
  children: ProfileChild[];
  months: number;
  history_note: string;
  earned_months?: number;
  deducted_months?: number;
  calendar: Record<string, { attended: number; planned: number }>;
  units: ProfileUnit[];
  month: string;
  backfills_available: boolean;
  camps_available: boolean;
}
export interface ProfileListRow {
  id: string;
  name: string;
  email: string;
  children: number;
  products: string[];
  months: number;
  last_seen_at?: string | null;
  revenue?: number | null;
}

export function familyStatus(months: number) {
  const value = Math.max(0, Math.floor(months));
  const tier =
    value >= 16
      ? "ultimate"
      : value >= 10
        ? "gold"
        : value >= 6
          ? "silver"
          : value >= 3
            ? "bronze"
            : "starter";
  const target =
    tier === "starter"
      ? 3
      : tier === "bronze"
        ? 6
        : tier === "silver"
          ? 10
          : 16;
  return {
    tier,
    label:
      tier === "ultimate"
        ? "Ultimativ"
        : tier === "gold"
          ? "Gold"
          : tier === "silver"
            ? "Silber"
            : tier === "bronze"
              ? "Bronze"
              : "Auf dem Weg zu Bronze",
    next:
      tier === "starter"
        ? "Bronze"
        : tier === "bronze"
          ? "Silber"
          : tier === "silver"
            ? "Gold"
            : tier === "gold"
              ? "Ultimativ"
              : null,
    target,
    remaining: tier === "ultimate" ? 0 : Math.max(0, target - value),
    progress: Math.min(100, (value / target) * 100),
  };
}

/** Covered ranges are merged per child: parallel subscriptions never multiply time. */
export function activeRanges(periods: ProfilePeriod[], now: string) {
  const limit = Date.parse(now);
  const ranges = periods
    .filter((p) => p.status === "active")
    .map((p) => [
      Date.parse(p.starts_at),
      Math.min(Date.parse(p.ends_at), limit),
    ])
    .filter(([a, b]) => Number.isFinite(a) && Number.isFinite(b) && b > a)
    .sort((a, b) => a[0] - b[0]);
  const merged: number[][] = [];
  for (const [start, end] of ranges) {
    const last = merged.at(-1);
    if (last && start <= last[1]) last[1] = Math.max(last[1], end);
    else merged.push([start, end]);
  }
  return merged;
}

/** Calendar anniversaries in Berlin, including month-end and DST handling. */
function monthCredits(start: number, end: number) {
  const anchor =
    Temporal.Instant.fromEpochMilliseconds(start).toZonedDateTimeISO(TIMEZONE);
  const finish =
    Temporal.Instant.fromEpochMilliseconds(end).toZonedDateTimeISO(TIMEZONE);
  const possible = Math.max(
    0,
    (finish.year - anchor.year) * 12 + finish.month - anchor.month,
  );
  const credits: number[] = [];
  for (let n = 1; n <= possible; n++) {
    const at = anchor.add({ months: n }).epochMilliseconds;
    if (at <= end) credits.push(at);
  }
  return credits;
}

export function subscriptionMonths(periods: ProfilePeriod[], now: string) {
  return activeRanges(periods, now).reduce(
    (n, [a, b]) => n + monthCredits(a, b).length,
    0,
  );
}

export function activeMembership(periods: ProfilePeriod[], now: string) {
  const ranges = activeRanges(periods, now);
  return {
    since: ranges.length ? new Date(ranges[0][0]).toISOString() : null,
    months: subscriptionMonths(periods, now),
  };
}

/** Historical helper retained for callers explicitly asking for elapsed time. */
export function membershipMonths(starts: string[], now: string) {
  const since =
    starts
      .filter(
        (s) =>
          Number.isFinite(Date.parse(s)) && Date.parse(s) <= Date.parse(now),
      )
      .sort((a, b) => Date.parse(a) - Date.parse(b))[0] ?? null;
  return {
    since,
    months: since
      ? subscriptionMonths(
          [
            {
              player_id: "",
              product_name: "",
              status: "active",
              starts_at: since,
              ends_at: now,
            },
          ],
          now,
        )
      : 0,
  };
}

/** Credits per child, one debit per wholly inactive family month; never carry debt. */
export function familyMembership(periods: ProfilePeriod[], now: string) {
  const events: { at: number; delta: number }[] = [];
  for (const player of new Set(periods.map((p) => p.player_id))) {
    for (const [a, b] of activeRanges(
      periods.filter((p) => p.player_id === player),
      now,
    ))
      events.push(...monthCredits(a, b).map((at) => ({ at, delta: 1 })));
  }
  const earned = events.length;
  const family = activeRanges(periods, now);
  for (let i = 0; i < family.length; i++) {
    const end = family[i + 1]?.[0] ?? Date.parse(now);
    events.push(
      ...monthCredits(family[i][1], end).map((at) => ({ at, delta: -1 })),
    );
  }
  // Debits first at a shared instant, so a zero balance cannot consume a new credit.
  events.sort((a, b) => a.at - b.at || a.delta - b.delta);
  let months = 0;
  for (const { delta } of events) months = Math.max(0, months + delta);
  return { months, earned_months: earned, deducted_months: earned - months };
}
export function trainingStats(units: ProfileUnit[], month: string) {
  const attended = units.filter((u) => !u.cancelled && isAttended(u.status));
  const sum = (rows: ProfileUnit[]) => ({
    count: rows.length,
    minutes: rows.reduce((n, u) => n + u.minutes, 0),
  });
  return {
    all: sum(attended),
    month: sum(
      attended.filter((u) => u.day?.slice(0, 7) === month.slice(0, 7)),
    ),
  };
}
export function profileCalendar(
  units: ProfileUnit[],
  month: string,
  now: string,
) {
  const result: ParentProfile["calendar"] = {};
  for (const u of units) {
    if (!u.day?.startsWith(month.slice(0, 7)) || u.cancelled) continue;
    const attended = isAttended(u.status);
    const planned =
      u.status === "planned" && !!u.starts_at && u.starts_at > now;
    if (!attended && !planned) continue;
    const day = (result[u.day] ??= { attended: 0, planned: 0 });
    if (attended) day.attended++;
    else day.planned++;
  }
  return result;
}
export function unitPreview(units: ProfileUnit[], now: string) {
  const next = units
    .filter(
      (u) =>
        !u.cancelled &&
        u.status === "planned" &&
        u.starts_at &&
        u.starts_at > now,
    )
    .sort((a, b) => a.starts_at!.localeCompare(b.starts_at!));
  const ids = new Set(next.map((u) => u.id));
  const past = units
    .filter((u) => !ids.has(u.id) && (!u.starts_at || u.starts_at <= now))
    .sort((a, b) => (b.day ?? "").localeCompare(a.day ?? ""));
  return [...next, ...past].slice(0, 5);
}
export function childAge(
  child: {
    birth_year?: number | null;
    camp_birth_date?: string | null;
    camp_age_at_booking?: number | null;
    camp_age_recorded_on?: string | null;
  },
  today: string,
) {
  if (child.camp_birth_date)
    return `${Temporal.PlainDate.from(child.camp_birth_date).until(Temporal.PlainDate.from(today), { largestUnit: "years" }).years} Jahre`;
  if (child.birth_year) return `Jahrgang ${child.birth_year}`;
  if (child.camp_age_at_booking != null && child.camp_age_recorded_on)
    return `${child.camp_age_at_booking} Jahre bei Buchung (${child.camp_age_recorded_on})`;
  return "Alter nicht hinterlegt";
}
export function eventUnit(
  p: {
    id: string;
    player_id: string;
    status: Attendance;
    removed_from_event?: boolean;
    reason?: string;
    training_events: any;
  },
  name: string,
  now: string,
): ProfileUnit | null {
  if (isRemovedParticipant(p)) return null;
  const e = p.training_events;
  if (!e) return null;
  const status = isAttended(p.status) && e.ends_at > now ? "planned" : p.status;
  return {
    id: p.id,
    player_id: p.player_id,
    child_name: name,
    title: e.title,
    event_type: e.event_type,
    starts_at: e.starts_at,
    ends_at: e.ends_at,
    day: calendarDate(e.starts_at),
    status,
    cancelled: e.status === "cancelled",
    minutes: durationMinutes(e.starts_at, e.ends_at),
    retrospective: false,
    location: e.locations?.name ?? "",
  };
}

export function childInitials(first: string, last: string) {
  return (
    `${first.trim().charAt(0)}${last.trim().charAt(0)}`.toLocaleUpperCase(
      "de-DE",
    ) || "?"
  );
}
export function childCardTheme(products: string[]) {
  const names = products
    .join(" ")
    .toLowerCase()
    .replace(/[\s&_-]+/g, "");
  if (
    names.includes("nextlevel") ||
    /(^|[^a-z])pro([^a-z]|$)/i.test(products.join(" "))
  )
    return "neon";
  if (names.includes("gamechanger")) return "purple";
  if (names.includes("firsttouch")) return "black";
  return "neutral";
}

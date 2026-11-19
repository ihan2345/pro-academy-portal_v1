// Design-Vorschau 2026: erfundene Beispieldaten für Familienseite,
// Spielerkarte, Shop und Geschenkkarten. Keine echten Personen.
import type { ParentProfile } from "@/lib/parent-profile";
import type { PlayerCardData } from "./player-card";
import { buildTrialBellEvents } from "@/lib/trials/bell";

const iso = (days: number, hour = 17) => {
  const d = new Date();
  d.setDate(d.getDate() + days);
  d.setHours(hour, 0, 0, 0);
  return d.toISOString();
};
const day = (days: number) => iso(days).slice(0, 10);

export function previewFamily(role: "parent" | "admin"): ParentProfile {
  const month = new Date().toISOString().slice(0, 7);
  const calendar: ParentProfile["calendar"] = {};
  for (const [d, a, p] of [
    [-12, 1, 0],
    [-9, 2, 0],
    [-5, 1, 0],
    [-2, 1, 0],
    [2, 0, 1],
    [5, 0, 2],
  ] as const) {
    const key = day(d);
    if (key.startsWith(month)) calendar[key] = { attended: a, planned: p };
  }
  const unit = (
    id: string,
    d: number,
    child: string,
    title: string,
    status: "attended_manual" | "planned",
  ) => ({
    id,
    player_id: child === "Noah Becker" ? "c-1" : "c-2",
    child_name: child,
    title,
    event_type: "Training",
    starts_at: iso(d),
    ends_at: iso(d, 18),
    day: day(d),
    status,
    cancelled: false,
    minutes: 60,
    retrospective: false,
    location: "Sportpark Nord",
  });
  return {
    id: "f-1",
    name: "Laura Becker",
    email: "laura.becker@example.com",
    phone: "+49 170 0000000",
    city: "Musterstadt",
    next_edit_at: null,
    role,
    portal_access:
      role === "admin"
        ? ({
            activated: true,
            last_seen_at: iso(-1),
            invitation: {
              status: "accepted",
              sent_at: iso(-90),
              accepted_at: iso(-89),
            },
          } as ParentProfile["portal_access"])
        : undefined,
    children: [
      {
        id: "c-1",
        first_name: "Noah",
        last_name: "Becker",
        name: "Noah Becker",
        age: "10 Jahre",
        birth_year: 2016,
        team: "U11",
        archived: false,
        products: ["Gamechanger"],
        since: iso(-240),
        months: 8,
        camps: 2,
        position: "Mittelfeld",
        strong_foot: "rechts",
        stats: {
          month: { count: 5, minutes: 300 },
          all: { count: 64, minutes: 3840 },
        },
      },
      {
        id: "c-2",
        first_name: "Mia",
        last_name: "Becker",
        name: "Mia Becker",
        age: "8 Jahre",
        birth_year: 2018,
        team: "U9",
        archived: false,
        products: ["First Touch"],
        since: iso(-60),
        months: 2,
        camps: 0,
        stats: {
          month: { count: 3, minutes: 180 },
          all: { count: 14, minutes: 840 },
        },
      },
    ],
    trial_children: [],
    months: 8,
    history_note: "Statusmonate zählen über alle Kinder der Familie.",
    has_subscription_history: true,
    earned_months: 8,
    deducted_months: 0,
    calendar,
    units: [
      unit("u-1", 5, "Noah Becker", "Techniktraining", "planned"),
      unit("u-2", 2, "Mia Becker", "Ballgefühl", "planned"),
      unit("u-3", -2, "Noah Becker", "Torschuss", "attended_manual"),
      unit("u-4", -5, "Mia Becker", "Koordination", "attended_manual"),
      unit("u-5", -9, "Noah Becker", "Dribbling", "attended_manual"),
    ],
    month,
    backfills_available: true,
    camps_available: true,
  };
}

export function previewPlayer(): PlayerCardData {
  return {
    spielername: "Noah Becker",
    elternteile: ["Laura Becker"],
    geburtsjahr: 2016,
    geschlecht: "männlich",
    verein: "SV Musterstadt",
    position: "Mittelfeld",
    fuss: "rechts",
    groesse_cm: 142,
    entwicklungsziele:
      "Schwächeren linken Fuß stärken.\nErster Kontakt unter Druck.\nMehr Abschlüsse aus der zweiten Reihe.",
    archiviert: false,
    abos: [{ art: "Gamechanger", von: iso(-12), bis: iso(18) }],
    aktive_monate: 8,
  };
}

const price = (amount: number, interval: "month" | null) => ({
  id: "price_preview",
  product_id: "prod_preview",
  amount,
  currency: "eur",
  interval,
  interval_count: 1 as const,
  livemode: false,
  checked_at: new Date().toISOString(),
  product_name: "",
  source: "fixture" as const,
});
const decision = {
  visible: true,
  purchasable: true,
  usable: true,
  mode: "checkout",
  label: "Jetzt buchen",
  reasons: [],
  audiences: [],
  player_id: "c-1",
};

export function previewProducts() {
  const rows = [
    {
      id: "pr-1",
      name: "Gamechanger",
      kind: "subscription",
      category: "Abo",
      short_description: "4 Einheiten im Monat, persönliche Ziele.",
      description: "",
      price: price(8900, "month"),
      featured: true,
      popular: false,
      effect_color: "#8B53FE",
    },
    {
      id: "pr-2",
      name: "Next Level Pro",
      kind: "subscription",
      category: "Abo",
      short_description: "8 Einheiten im Monat und Videoanalyse.",
      description: "",
      price: price(15900, "month"),
      featured: false,
      popular: true,
      effect_color: "#8EFF01",
    },
    {
      id: "pr-3",
      name: "First Touch",
      kind: "subscription",
      category: "Abo",
      short_description: "Der Einstieg für die Kleinen.",
      description: "",
      price: price(4900, "month"),
      featured: false,
      popular: false,
    },
    {
      id: "pr-4",
      name: "Ostercamp",
      kind: "camp",
      category: "Camp",
      short_description: "3 Tage Fußball, Verpflegung inklusive.",
      description: "",
      price: price(19900, null),
      featured: false,
      popular: false,
      camp_pricing: {
        early_until: null,
        benefit_available: false,
        percent: 0,
        personal_amount: null,
        child_name: null,
        seats: { left: 4, maximum: 26, share: 22 / 26 },
      },
    },
    {
      id: "pr-5",
      name: "Geschenkkarte",
      kind: "gift",
      category: "Geschenk",
      short_description: "Training verschenken.",
      description: "",
      price: null,
      gift_amount: 2500,
      gift_amounts: [2500, 5000, 10000],
      featured: false,
      popular: false,
    },
  ].map((p) => ({
    asset_ids: [],
    training_content: null,
    sale_enabled: false,
    sale_audiences: [],
    decision,
    ...p,
  }));
  return {
    rows,
    next: null,
    payments_enabled: false,
    gifts_enabled: true,
    context: {
      auth_id: null,
      role: "parent",
      parent_id: "f-1",
      complete: true,
      grants: [],
      children: [
        {
          id: "c-1",
          name: "Noah Becker",
          first_name: "Noah",
          last_name: "Becker",
          birth_date: null,
          trial: false,
          former_trial: false,
          memberships: [],
          camp_ids: [],
          purchases: [],
        },
        {
          id: "c-2",
          name: "Mia Becker",
          first_name: "Mia",
          last_name: "Becker",
          birth_date: null,
          trial: false,
          former_trial: false,
          memberships: [],
          camp_ids: [],
          purchases: [],
        },
      ],
    },
  };
}

export function previewGifts() {
  const card = (
    id: string,
    roles: ("buyer" | "recipient")[],
    initial: number,
    remaining: number,
    buyer: string,
    recipient: string,
    expires: number,
  ) => ({
    id,
    roles,
    initial_amount: initial,
    remaining,
    reserved: 0,
    available: roles.includes("recipient") ? remaining : 0,
    gift_status: remaining ? "active" : "spent",
    expires_at: iso(expires),
    buyer_name: buyer,
    recipient_name: recipient,
    code: roles.includes("recipient") && remaining ? "PA-DEMO-4821" : null,
    status: "paid",
  });
  const cards = [
    card("g-1", ["recipient"], 10000, 6500, "Oma Gisela", "Laura", 300),
    card("g-2", ["recipient"], 5000, 5000, "Familie Kaya", "Laura", 120),
    card("g-3", ["buyer"], 5000, 5000, "Laura", "Derya Yilmaz", 330),
  ];
  return {
    cards,
    available: cards.reduce((s, c) => s + c.available, 0),
    has_cards: true,
    welcome_key: "preview",
    user_id: "preview",
  };
}

const kidNames = [
  ["Noah", "Becker", "U11", "Gamechanger", 8, 3840],
  ["Mia", "Becker", "U9", "First Touch", 2, 840],
  ["Elias", "Kaya", "U13", "Next Level Pro", 14, 6900],
  ["Lea", "Yilmaz", "U11", "Gamechanger", 5, 2400],
  ["Ben", "Schulz", "U10", "First Touch", 1, 300],
  ["Emma", "Wagner", "U12", "Gamechanger", 11, 5100],
] as const;

export function previewPlayerProfiles() {
  const rows = kidNames.map(
    ([first, last, team, product, months, minutes], i) => ({
      id: `c-${i + 1}`,
      first_name: first,
      last_name: last,
      name: `${first} ${last}`,
      age: `${9 + (i % 4)} Jahre`,
      birth_year: 2016 - (i % 4),
      team,
      archived: false,
      products: [product],
      since: iso(-months * 30),
      months,
      camps: i % 3,
      stats: {
        month: { count: 2 + (i % 3), minutes: 120 + i * 30 },
        all: { count: Math.round(minutes / 60), minutes },
      },
      parents: [{ id: `f-${i + 1}`, name: `Familie ${last}` }],
      trainingAvailable: true,
    }),
  );
  return { rows, next: null, total: rows.length };
}

export function previewParentList() {
  const rows = kidNames.slice(0, 5).map(([, last, , product, months], i) => ({
    id: `f-${i + 1}`,
    name: `Familie ${last}`,
    email: `${last.toLowerCase()}@example.com`,
    children: last === "Becker" ? 2 : 1,
    products: [product],
    months,
    portal_access: {
      activated: i < 3,
      signed_in: i < 3,
      // Vorschau: eine Familie gerade online, eine vor 10 Minuten.
      last_seen_at:
        i === 0
          ? new Date().toISOString()
          : i === 1
            ? new Date(Date.now() - 10 * 60000).toISOString()
            : i === 2
              ? iso(-2)
              : null,
      invitation: {
        status: i === 3 ? "sent" : i === 4 ? "none" : "accepted",
        sent_at: i === 4 ? null : iso(-60),
        accepted_at: i < 3 ? iso(-59) : null,
      },
    },
  }));
  return { rows, total: rows.length, more: false };
}

export function previewActivities(path: string) {
  if (path.endsWith("/summary"))
    return { asOf: new Date().toISOString(), recent: 14, open: 2 };
  const rows = [
    ["Training bestätigt", "Techniktraining am Sportpark Nord", "success"],
    ["Neue Buchung", "Ostercamp für Lea Yilmaz", "success"],
    ["Zahlung offen", "Gamechanger für Ben Schulz", "problem"],
    ["Bericht versendet", "Monatsbericht an Familie Kaya", "normal"],
  ].map(([title, text, tone], i) => ({
    id: `a-${i}`,
    at: iso(-i / 4),
    title,
    text,
    subject: null,
    actor: "System",
    tone,
  }));
  return { rows, next: null, total: rows.length };
}

/** Drei offene Zahlungen in verschiedenen Eskalationsstufen (14, 3, 1 Tag). */
export function previewConflicts() {
  const row = (
    i: number,
    customer: string,
    child: string,
    daysAgo: number,
  ) => ({
    id: `conflict-${i}`,
    at: new Date(Date.now() - daysAgo * 86400000).toISOString(),
    customer,
    customerId: `cus_preview_${i}`,
    subscriptionId: `sub_preview_${i}`,
    status: "past_due",
    reason: "Zahlung fehlgeschlagen",
    blocked: false,
    children: [{ id: `p-${i}`, name: child }],
    invoices: [],
    href: "https://dashboard.stripe.com/test/subscriptions",
  });
  return {
    checkedAt: new Date().toISOString(),
    rows: [
      row(1, "Familie Kaya", "Emir Kaya", 13.4),
      row(2, "Familie Schulz", "Ben Schulz", 11.5),
      row(3, "Familie Weber", "Mia Weber", 2),
    ],
  };
}

export function previewTrials() {
  const row = (
    i: number,
    first: string,
    last: string,
    status: string,
    extra: Record<string, unknown> = {},
  ) => ({
    id: `t-${i}`,
    family_id: `tf-${i}`,
    player_id: `tp-${i}`,
    first_name: first,
    last_name: last,
    birth_date: "2016-05-01",
    club: "SV Musterstadt",
    status,
    team_note: "",
    event_id: null,
    participant_id: null,
    confirmed_at: null,
    parent_name: `Familie ${last}`,
    email: `${last.toLowerCase()}@example.com`,
    phone: "+49 170 0000000",
    preferred_location: "Sportpark Nord",
    availability: "Nachmittags",
    email_verified: true,
    event_title: null,
    starts_at: null,
    ends_at: null,
    event_status: null,
    created_at: iso(-2),
    ...extra,
  });
  return {
    rows: [
      row(1, "Luca", "Hoffmann", "new"),
      row(2, "Sofia", "Klein", "new"),
      row(3, "Jonas", "Wolf", "planned", {
        event_title: "Techniktraining",
        starts_at: iso(3),
        ends_at: iso(3, 18),
      }),
      row(4, "Ida", "Neumann", "attended", {
        confirmed_at: iso(-3),
        academy_ready: false,
      }),
    ],
    events: [{ id: "e-1", title: "Techniktraining", starts_at: iso(3) }],
    staff: [{ id: "t-1", display_name: "Coach Max" }],
  };
}

/** Bereits stattgefundene Einheiten für „Rückwirkend eintragen“. */
export function previewTrialPastEvents() {
  const unit = (
    i: number,
    days: number,
    hour: number,
    title: string,
    location: string,
    coach: string,
  ) => ({
    id: `pe-${i}`,
    title,
    starts_at: iso(days, hour),
    ends_at: iso(days, hour + 1),
    location,
    coach,
  });
  return {
    events: [
      unit(1, -40, 16, "Techniktraining U9–12", "Sportpark Nord", "Coach Max"),
      unit(2, -33, 17, "Torschuss", "Halle West", "Coach Lea"),
      unit(3, -26, 16, "Techniktraining U9–12", "Sportpark Nord", "Coach Max"),
      unit(4, -19, 16, "Techniktraining U9–12", "Sportpark Nord", "Coach Max"),
      unit(5, -12, 17, "Torschuss", "Halle West", "Coach Lea"),
      unit(6, -5, 15, "Koordination U6–8", "Sportpark Nord", "Coach Lea"),
      unit(7, -5, 17, "Techniktraining U9–12", "Sportpark Nord", "Coach Max"),
      unit(8, -2, 16, "Spielformen", "Halle West", "Coach Max"),
    ],
  };
}

/** Archiv „Alle Spieler“: Abo, nur Camp, Probetraining und Inaktive. */
export function previewPlayerArchive() {
  const abo = previewPlayerProfiles().rows.map((r) => ({
    id: r.id,
    name: r.name,
    first_name: r.first_name,
    last_name: r.last_name,
    age: r.age,
    team: r.team,
    archived: false,
    created: r.since,
    status: "abo" as const,
    products: [...r.products],
    formerProducts: [...r.products],
    months: r.months,
    since: r.since,
    trainings: r.stats.all.count,
    minutes: r.stats.all.minutes,
    camps: r.camps,
    trial: null,
    parents: r.parents,
  }));
  const others = (
    [
      ["Lina", "Hoffmann", "camp", 0, 0, 2, null, []],
      ["Jonas", "Arslan", "camp", 0, 0, 1, null, []],
      ["Finn", "Richter", "camp", 0, 0, 3, "closed", []],
      ["Sofia", "Demir", "trial", 0, 1, 0, "attended", []],
      ["Paul", "Krüger", "trial", 0, 0, 0, "planned", []],
      ["Ida", "Neumann", "trial", 0, 0, 0, "new", []],
      ["Luca", "Schmitt", "inactive", 9, 34, 2, null, ["Gamechanger"]],
      ["Mila", "Fischer", "inactive", 4, 15, 0, null, ["First Touch"]],
      ["Tim", "Braun", "inactive", 0, 0, 0, null, []],
    ] as const
  ).map(
    ([first, last, status, months, trainings, camps, trial, former], i) => ({
      id: `a-${i + 1}`,
      name: `${first} ${last}`,
      first_name: first,
      last_name: last,
      age: `${8 + (i % 5)} Jahre`,
      team: i % 2 ? "U10" : "U12",
      archived: last === "Braun",
      // Für die Kachel „Neueste Spieler“: einige Profile aus den letzten 30 Tagen.
      created: iso(
        -[0, 0, 1, 3, 3, 3, 9, 16, 24][i],
        [8, 10, 12, 9, 11, 15, 16, 14, 10][i],
      ),
      status,
      products: [] as string[],
      formerProducts: [...former],
      months,
      since: months ? iso(-months * 30 - 120) : null,
      trainings,
      minutes: trainings * 75,
      camps,
      trial,
      parents: [{ id: `fa-${i + 1}`, name: `Familie ${last}` }],
    }),
  );
  return {
    rows: [...abo, ...others].sort((a, b) =>
      a.name.localeCompare(b.name, "de"),
    ),
    trainingAvailable: true,
  };
}

/** Probetraining-Ereignisse für die Glocke in der Vorschau. */
export function previewTrialNotices() {
  const now = Date.now();
  const ago = (h: number) => new Date(now - h * 3600000).toISOString();
  const row = (
    n: number,
    first: string,
    last: string,
    parent: string,
    extra: Record<string, string | null> = {},
  ) => ({
    id: `00000000-0000-4000-8000-00000000070${n}`,
    family_id: `00000000-0000-4000-8000-00000000080${n}`,
    first_name: first,
    last_name: last,
    parent_name: parent,
    status: "planned",
    created_at: ago(24 * 20),
    ...extra,
  });
  return {
    rows: buildTrialBellEvents(
      {
        rows: [
          row(1, "Elias", "Yilmaz", "Derya Yilmaz", {
            status: "new",
            created_at: ago(2),
          }),
          row(2, "Mia", "Schulte", "Anna Schulte", {
            scheduled_at: ago(30),
            starts_at: ago(-50),
            event_title: "U10 Technik Dienstag",
          }),
          row(3, "Noah", "Krämer", "Jan Krämer", {
            scheduled_at: ago(6),
            confirmed_at: ago(6),
            starts_at: ago(70),
            attendance: "attended_manual",
            event_title: "U12 Athletik",
            feedback_at: ago(5),
          }),
          row(4, "Lina", "Becker", "Sven Becker", {
            converted_at: ago(20),
            converted_player_id: "00000000-0000-4000-8000-000000000101",
          }),
        ],
        feedback: [
          {
            request_id: "00000000-0000-4000-8000-000000000703",
            rating: 2,
            feedback: "Die Gruppe war sehr voll, Noah kam kaum an den Ball.",
            created_at: ago(1),
            comment_submitted_at: ago(1),
          },
        ],
        mails: [
          {
            id: "00000000-0000-4000-8000-000000000901",
            kind: "trial_feedback",
            status: "sent",
            updated_at: ago(4.5),
            payload: { request_id: "00000000-0000-4000-8000-000000000703" },
          },
          {
            id: "00000000-0000-4000-8000-000000000902",
            kind: "trial_day7",
            status: "sent",
            updated_at: ago(26),
            payload: { family_id: "00000000-0000-4000-8000-000000000802" },
          },
        ],
        audits: [],
        families: [],
      },
      now,
    ),
  };
}

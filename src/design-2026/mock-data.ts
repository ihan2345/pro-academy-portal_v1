// Design-Vorschau 2026: reine Beispieldaten für /design-vorschau.
// Wird nur gerendert, wenn DESIGN_PREVIEW=true gesetzt ist. Keine echten Kundendaten.
import type { PortalData, Training } from "@/lib/types";

const day = 24 * 60 * 60 * 1000;
function at(offsetDays: number, hour: number, minutes = 0) {
  const d = new Date(Date.now() + offsetDays * day);
  d.setHours(hour, minutes, 0, 0);
  return d.toISOString();
}
const periodId = "p-1";
const places = [
  {
    id: "l-1",
    name: "Sportpark Nord",
    address: "Am Sportpark 1, 40000 Musterstadt",
    trainer_id: "t-1",
    trainer_name: "Coach Max",
  },
  {
    id: "l-2",
    name: "Sporthalle Mitte",
    address: "Hallenweg 5, 40000 Musterstadt",
    trainer_id: "t-2",
    trainer_name: "Coach Ayşe",
  },
];
function training(
  id: string,
  offset: number,
  hour: number,
  title: string,
  status: Training["participants"][number]["status"],
  period = periodId,
  place = 0,
): Training {
  const loc = places[place % places.length];
  return {
    id,
    title,
    starts_at: at(offset, hour),
    ends_at: at(offset, hour + 1, 30),
    location_id: loc.id,
    location_name: loc.name,
    address: loc.address,
    trainer_id: loc.trainer_id,
    trainer_name: loc.trainer_name,
    event_type: "football",
    status: "scheduled",
    auto_attendance_at: at(offset, hour + 2),
    participants: [
      {
        id: `${id}-pp`,
        player_id: "c-1",
        period_id: period,
        status,
      },
    ],
  };
}

export function previewPortal(): PortalData {
  return {
    products_enabled: true,
    camp_enabled: true,
    camp_access: "active",
    role: "parent",
    user_name: "Laura",
    email: "laura@example.com",
    whatsapp: "4900000000000",
    players: [
      { id: "c-1", first_name: "Noah", last_name: "Becker", team: "U11" },
      { id: "c-2", first_name: "Mia", last_name: "Becker", team: "U9" },
    ],
    periods: [
      {
        id: "p-m1",
        player_id: "c-1",
        product_name: "FirstTouch",
        starts_at: at(-74, 0),
        ends_at: at(-44, 0),
        included_units: 4,
        status: "completed",
        subscription_id: "s-1",
        subscription_status: "active",
      },
      {
        id: "p-0",
        player_id: "c-1",
        product_name: "FirstTouch",
        starts_at: at(-44, 0),
        ends_at: at(-14, 0),
        included_units: 4,
        status: "completed",
        subscription_id: "s-1",
        subscription_status: "active",
      },
      {
        id: periodId,
        player_id: "c-1",
        product_name: "FirstTouch",
        starts_at: at(-14, 0),
        ends_at: at(16, 0),
        included_units: 4,
        status: "active",
        subscription_id: "s-1",
        subscription_status: "active",
      },
    ],
    events: [
      training(
        "e-m1",
        -70,
        17,
        "Technik & Ballkontrolle",
        "attended_auto",
        "p-m1",
      ),
      training(
        "e-m2",
        -63,
        17,
        "Passspiel & Spielaufbau",
        "attended_auto",
        "p-m1",
        1,
      ),
      training("e-m3", -56, 17, "Abschluss & Torschuss", "excused", "p-m1"),
      training(
        "e-m4",
        -49,
        17,
        "Athletik & Koordination",
        "attended_manual",
        "p-m1",
        1,
      ),
      training(
        "e-01",
        -40,
        17,
        "1-gegen-1 & Dribbling",
        "attended_auto",
        "p-0",
      ),
      training(
        "e-02",
        -33,
        17,
        "Technik & Ballkontrolle",
        "attended_auto",
        "p-0",
        1,
      ),
      training(
        "e-03",
        -26,
        17,
        "Passspiel & Spielaufbau",
        "attended_auto",
        "p-0",
      ),
      training(
        "e-04",
        -19,
        17,
        "Abschluss & Torschuss",
        "attended_manual",
        "p-0",
      ),
      training("e-1", -12, 17, "Technik & Ballkontrolle", "attended_auto"),
      training(
        "e-2",
        -5,
        17,
        "Passspiel & Spielaufbau",
        "attended_manual",
        periodId,
        1,
      ),
      training("e-3", 2, 17, "Abschluss & Torschuss", "planned"),
      training(
        "e-3b",
        5,
        16,
        "Athletik & Koordination",
        "planned",
        periodId,
        1,
      ),
      training("e-4", 9, 17, "1-gegen-1 & Dribbling", "planned"),
    ],
    reports: [
      {
        id: "r-1",
        player_id: "c-1",
        period_id: "p-0",
        version: 1,
        created_at: at(-20, 9),
        product_name: "FirstTouch",
        period_label: "Oktober 2026",
        completed: 4,
        units: 4,
        minutes: 360,
      },
    ],
    locations: [
      { id: "l-1", name: "Sportpark Nord", address: "Am Sportpark 1" },
    ],
    trainers: [{ id: "t-1", name: "Coach Max" }],
    backfills: [],
    billing_customers: [{ stripe_customer_id: "cus_preview" }],
  };
}

export function previewCamps() {
  const camp = (
    id: string,
    title: string,
    start: number,
    days: number,
    status: string,
    description: string,
    location: string,
  ) => ({
    id,
    title,
    location,
    description,
    capacity: 24,
    buffer_percent: 10,
    min_age: 6,
    max_age: 13,
    status,
    payment_mode: "live" as const,
    early_bird_until: at(start - 20, 0),
    occupied: 22,
    days: Array.from({ length: days }, (_, i) => ({
      starts_at: at(start + i, 10),
      ends_at: at(start + i, 15),
    })),
  });
  return {
    role: "parent",
    locations: [],
    camps: [
      camp(
        "11111111-1111-4111-8111-111111111111",
        "Winter Camp 2026",
        40,
        3,
        "open",
        "Drei Tage Technik, Spielformen und Teamgeist in der Halle.",
        "Sporthalle Mitte",
      ),
      camp(
        "22222222-2222-4222-8222-222222222222",
        "Oster Camp 2027",
        140,
        4,
        "open",
        "Vier Tage auf dem Platz mit Abschlussturnier für die ganze Familie.",
        "Sportpark Nord",
      ),
      camp(
        "33333333-3333-4333-8333-333333333333",
        "Herbst Camp 2026",
        -30,
        3,
        "closed",
        "Unser Herbst Camp mit Torschuss-Challenge.",
        "Sportpark Nord",
      ),
    ],
    bookings: [],
    offers: [
      {
        id: "o-1",
        camp_id: "11111111-1111-4111-8111-111111111111",
        kind: "main",
        amount: 14900,
        currency: "eur",
      },
      {
        id: "o-2",
        camp_id: "22222222-2222-4222-8222-222222222222",
        kind: "early",
        amount: 17900,
        currency: "eur",
      },
      {
        id: "o-3",
        camp_id: "33333333-3333-4333-8333-333333333333",
        kind: "main",
        amount: 14900,
        currency: "eur",
      },
    ],
    plans: [],
    reports: [],
    children: [
      { id: "c-1", first_name: "Noah", last_name: "Becker", percent: 15 },
      { id: "c-2", first_name: "Mia", last_name: "Becker", percent: 15 },
    ],
  };
}

const firstNames = [
  "Noah",
  "Mia",
  "Elias",
  "Lina",
  "Ben",
  "Emma",
  "Paul",
  "Lea",
  "Finn",
  "Sofia",
  "Leon",
  "Hanna",
];
const lastNames = [
  "Becker",
  "Becker",
  "Yilmaz",
  "Schulz",
  "Wagner",
  "Hoffmann",
  "Kaya",
  "Klein",
  "Wolf",
  "Neumann",
  "Demir",
  "Krause",
];

export function previewAdminPortal(): PortalData {
  const base = previewPortal();
  const players = firstNames.map((first_name, i) => ({
    id: `c-${i + 1}`,
    first_name,
    last_name: lastNames[i],
    team: ["U9", "U11", "U13"][i % 3],
  }));
  const titles = [
    "Technik & Ballkontrolle",
    "Passspiel & Spielaufbau",
    "Abschluss & Torschuss",
    "1-gegen-1 & Dribbling",
    "Athletik & Koordination",
  ];
  const events: Training[] = [];
  for (let d = -10; d <= 12; d += 2)
    players.slice(0, 6).forEach((p, i) => {
      if ((d + i) % 3) return;
      const t = training(
        `ea-${d}-${i}`,
        d,
        15 + (i % 4),
        titles[(i + d + 20) % titles.length],
        d < 0 && d > -4 ? "planned" : d < 0 ? "attended_auto" : "planned",
        periodId,
        i,
      );
      t.participants = [
        { ...t.participants[0], id: `${t.id}-pp`, player_id: p.id },
      ];
      events.push(t);
    });
  // Gruppentermin mit allen Kreis-Zuständen und „+N“-Liste.
  const group = training("ea-gruppe", 0, 9, "Gruppe Vormittag", "planned");
  const states: [
    Training["participants"][number]["status"],
    boolean,
    boolean,
  ][] = [
    ["attended_manual", true, true],
    ["attended_manual", true, false],
    ["attended_auto", false, false],
    ["absent", true, false],
    ["cancelled", false, false],
    ["excused", true, false],
    ["excused", false, false],
    ["planned", true, false],
    ["planned", false, false],
    ["attended_auto", true, true],
  ];
  group.participants = players.slice(0, states.length).map((p, i) => ({
    id: `ea-gruppe-${i}`,
    player_id: p.id,
    period_id: periodId,
    status: states[i][0],
    parent_active: states[i][1],
    attendance_mail_sent: states[i][2],
  }));
  events.push(group);
  return {
    ...base,
    role: "admin",
    user_name: "Kaan",
    email: "admin@example.com",
    camp_access: undefined,
    players,
    events,
    reports: [
      ...base.reports,
      ...base.reports.map((r) => ({ ...r, id: "r-2" })),
    ],
    locations: [
      { id: "l-1", name: "Sportpark Nord", address: "Am Sportpark 1" },
      { id: "l-2", name: "Sporthalle Mitte", address: "Hallenweg 5" },
    ],
    trainers: [
      { id: "t-1", name: "Coach Max" },
      { id: "t-2", name: "Coach Ayşe" },
    ],
  };
}

export function previewAdminRows(table: string): Record<string, unknown>[] {
  const admin = previewAdminPortal();
  if (table === "players")
    return admin.players.map((p, i) => ({
      ...p,
      birth_year: 2014 + (i % 5),
      parent_players: i % 4 ? [{ parent_id: `pa-${i}` }] : [],
    }));
  if (table === "parents")
    return admin.players.slice(0, 8).map((p, i) => ({
      id: `pa-${i}`,
      full_name: `${["Laura", "Sven", "Aylin", "Jana", "Murat", "Sarah", "Tim", "Nina"][i]} ${p.last_name}`,
      contact_email: `eltern${i + 1}@example.com`,
      billing_email: `eltern${i + 1}@example.com`,
      parent_players: i % 3 ? [{ player_id: p.id }] : [],
    }));
  if (table === "locations")
    return admin.locations.map((l) => ({ ...l, active: true }));
  if (table === "staff_profiles")
    return [
      { id: "t-1", display_name: "Coach Max", active: true },
      { id: "t-2", display_name: "Coach Ayşe", active: true },
    ];
  return [];
}

// Vorschau: Camp-Kundenliste mit erfundenen Beispielfamilien.
export function previewCampCustomers() {
  const kids = [
    [
      "Brandt",
      "Jonas",
      "2016-03-12",
      "140",
      "subscriber",
      "Sabine Brandt",
      "sabine.brandt@example.com",
      "0170 1234567",
      "Ohne ProAcademy Trikot-Set",
    ],
    [
      "Celik",
      "Emir",
      "2018-06-11",
      "128",
      "new",
      "Murat Celik",
      "murat.celik@example.com",
      "0172 2345678",
      "",
    ],
    [
      "Fischer",
      "Lena",
      "2015-09-02",
      "152",
      "none",
      "Thomas Fischer",
      "t.fischer@example.com",
      "0151 3456789",
      "Mit ProAcademy Trikot-Set",
    ],
    [
      "Hoffmann",
      "Paul",
      "2014-10-01",
      "164",
      "subscriber",
      "Julia Hoffmann",
      "julia.hoffmann.familie@example.com",
      "0173 4567890",
      "Ohne ProAcademy Trikot-Set",
    ],
    [
      "Kaya",
      "Deniz",
      "2019-04-29",
      "116",
      "subscriber",
      "Ayla Kaya",
      "ayla.kaya@example.com",
      "0179 5678901",
      "",
    ],
    [
      "Schneider",
      "Max",
      "2016-03-27",
      "140",
      "none",
      "Kevin Schneider",
      "kevin.schneider@example.com",
      "0151 6789012",
      "",
    ],
    [
      "Wagner",
      "Luka",
      "2014-07-17",
      "S",
      "subscriber",
      "Anna Wagner-Lindqvist",
      "anna.wagner@example.com",
      "0162 7890123",
      "Mit ProAcademy Trikot-Set",
    ],
    [
      "Yilmaz",
      "Elif",
      "2017-11-10",
      "M",
      "new",
      "Selin Yilmaz",
      "selin.yilmaz@example.com",
      "0176 8901234",
      "Ohne ProAcademy Trikot-Set",
    ],
  ] as const;
  return {
    role: "admin",
    camp: { id: "preview-camp", title: "Winter-Camp PAbyAK (28.–30.12.26)" },
    rows: kids.map((k, i) => ({
      id: `preview-customer-${i}`,
      last_name: k[0],
      first_name: k[1],
      birth_date: k[2],
      birth_year: k[2].slice(0, 4),
      clothing_size: k[3],
      gender: i % 3 === 2 ? "weiblich" : "männlich",
      customer_group: k[4],
      parent_name: k[5],
      email: k[6],
      phone: k[7],
      booked_at: `2026-11-1${3 + (i % 5)}T1${i}:0${i}:00+01:00`,
      option_title: k[8],
      attendance: "Gebucht",
      paid_amount: k[8] ? 19900 : 22900,
      currency: "EUR",
    })),
  };
}

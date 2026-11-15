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
function training(
  id: string,
  offset: number,
  hour: number,
  title: string,
  status: Training["participants"][number]["status"],
): Training {
  return {
    id,
    title,
    starts_at: at(offset, hour),
    ends_at: at(offset, hour + 1, 30),
    location_id: "l-1",
    location_name: "Sportpark Nord",
    address: "Am Sportpark 1, 40000 Musterstadt",
    trainer_id: "t-1",
    trainer_name: "Coach Max",
    event_type: "football",
    status: "scheduled",
    auto_attendance_at: at(offset, hour + 2),
    participants: [
      {
        id: `${id}-pp`,
        player_id: "c-1",
        period_id: periodId,
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
      training("e-1", -12, 17, "Technik & Ballkontrolle", "attended_auto"),
      training("e-2", -5, 17, "Passspiel & Spielaufbau", "attended_manual"),
      training("e-3", 2, 17, "Abschluss & Torschuss", "planned"),
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
    occupied: 17,
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

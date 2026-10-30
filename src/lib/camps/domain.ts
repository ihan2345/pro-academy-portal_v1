import { z } from "zod";

export type CampBookingStatus = "paid" | "review" | null;
export function childBookingStatus(
  bookings: { player_id: string | null; status: string }[],
  playerId: string,
): CampBookingStatus {
  const own = bookings.filter((b) => b.player_id === playerId);
  if (own.some((b) => b.status === "paid")) return "paid";
  return own.some((b) => b.status === "review") ? "review" : null;
}

export const benefitSchema = z
  .union([z.literal(10), z.literal(15), z.literal(20)])
  .nullable();
export const campBenefitUpdateSchema = z.object({
  // Seeded tariff IDs are valid PostgreSQL UUIDs without RFC version bits.
  id: z.guid(),
  percent: benefitSchema,
});
export const childSchema = z.object({
  first_name: z.string().trim().min(1).max(80),
  last_name: z.string().trim().min(1).max(80),
  birth_date: z.iso.date(),
  gender: z.enum(["weiblich", "männlich", "divers", "keine Angabe"]),
  clothing_size: z.string().trim().min(1).max(20),
});
export const bookingSchema = z.object({
  camp_id: z.uuid(),
  player_id: z.uuid().optional(),
  parent: z.object({
    name: z.string().trim().min(2).max(160),
    email: z.email(),
    phone: z.string().trim().min(5).max(40),
  }),
  child: childSchema,
});
export const offerSchema = z.object({
  price_id: z.string().regex(/^price_[A-Za-z0-9]+$/),
  payment_link_id: z.string().regex(/^plink_[A-Za-z0-9]+$/),
  codes: z.object({
    "10": z.string().trim().max(100),
    "15": z.string().trim().max(100),
    "20": z.string().trim().max(100),
  }),
});
export const campSchema = z
  .object({
    id: z.uuid().optional(),
    title: z.string().trim().min(3).max(150),
    location: z.string().trim().min(3).max(250),
    description: z.string().trim().max(4000),
    capacity: z.number().int().min(1).max(1000),
    buffer_percent: z.number().int().min(0).max(20).default(10),
    min_age: z.number().int().min(3).max(99),
    max_age: z.number().int().min(3).max(99),
    status: z.enum(["draft", "open", "closed", "archived"]),
    days: z
      .array(
        z.object({
          starts_at: z.iso.datetime({ offset: true }),
          ends_at: z.iso.datetime({ offset: true }),
        }),
      )
      .min(1)
      .max(30),
    early_bird_until: z.iso.datetime({ offset: true }).nullable(),
    main: offerSchema.optional(),
    early: offerSchema.optional(),
  })
  .superRefine((c, ctx) => {
    if (c.max_age < c.min_age)
      ctx.addIssue({ code: "custom", message: "Altersgrenzen prüfen." });
    for (const d of c.days)
      if (Date.parse(d.ends_at) <= Date.parse(d.starts_at))
        ctx.addIssue({
          code: "custom",
          message: "Trainingsende muss nach dem Beginn liegen.",
        });
    if (
      c.early_bird_until &&
      c.days.some(
        (d) => Date.parse(c.early_bird_until!) >= Date.parse(d.starts_at),
      )
    )
      ctx.addIssue({
        code: "custom",
        message: "Die Frühbucherfrist muss vor Camp-Beginn enden.",
      });
    const dates = c.days.map((d) => d.starts_at.slice(0, 10));
    if (new Set(dates).size !== dates.length)
      ctx.addIssue({
        code: "custom",
        message: "Bitte jeden Camp-Tag nur einmal angeben.",
      });
  });
export type Camp = {
  payment_mode: "test" | "live";
  id: string;
  title: string;
  location: string;
  description: string;
  capacity: number;
  buffer_percent: number;
  min_age: number;
  max_age: number;
  status: string;
  days: { starts_at: string; ends_at: string }[];
  early_bird_until: string | null;
};
export type Offer = {
  id: string;
  camp_id: string;
  kind: "main" | "early";
  plan_id: string;
  stripe_price_id: string;
  stripe_product_id: string;
  stripe_payment_link_id: string | null;
  payment_url: string | null;
  amount: number;
  currency: string;
  codes: Record<string, string>;
};
export function currentOffer<T extends { kind: string }>(
  offers: T[],
  deadline: string | null,
  now = Date.now(),
) {
  const kind = deadline && now < Date.parse(deadline) ? "early" : "main";
  return offers.find((o) => o.kind === kind);
}
export function ageAt(birth: string, instant: string) {
  const day = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Europe/Berlin",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date(instant));
  const [y, m, d] = birth.split("-").map(Number),
    [cy, cm, cd] = day.split("-").map(Number);
  return cy - y - (cm < m || (cm === m && cd < d) ? 1 : 0);
}
export function maximumSeats(camp: Pick<Camp, "capacity" | "buffer_percent">) {
  return (
    camp.capacity + Math.floor((camp.capacity * camp.buffer_percent) / 100)
  );
}
export function money(amount: number, currency = "eur") {
  return new Intl.NumberFormat("de-DE", { style: "currency", currency }).format(
    amount / 100,
  );
}
export function bestBenefit(values: (number | null | undefined)[]) {
  return Math.max(
    0,
    ...values.filter((x): x is number => [10, 15, 20].includes(x ?? 0)),
  );
}

export function campTiming(camp: Pick<Camp, "days">, now = Date.now()) {
  const start = Math.min(...camp.days.map((d) => Date.parse(d.starts_at)));
  const end = Math.max(...camp.days.map((d) => Date.parse(d.ends_at)));
  const hours = camp.days.reduce(
    (sum, d) =>
      sum + (Date.parse(d.ends_at) - Date.parse(d.starts_at)) / 3600000,
    0,
  );
  return {
    start,
    end,
    hours,
    phase: now >= end ? "past" : now >= start ? "ongoing" : "upcoming",
  };
}

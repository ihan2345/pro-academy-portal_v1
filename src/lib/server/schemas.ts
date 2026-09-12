import { z } from "zod";
const id = z.uuid(),
  name = z.string().trim().min(1).max(120),
  reason = z.string().trim().min(3).max(500);
export const trainingSchema = z
  .object({
    id: id.optional(),
    revision: z.number().int().positive().optional(),
    title: name,
    starts_at: z.iso.datetime({ offset: true }),
    ends_at: z.iso.datetime({ offset: true }),
    location_id: id,
    trainer_id: id,
    event_type: z.enum([
      "Gruppentraining",
      "Einzeltraining",
      "Athletiktraining",
      "Fördertraining",
    ]),
    player_ids: z
      .array(id)
      .min(1)
      .max(100)
      .refine((a) => new Set(a).size === a.length, "Kind doppelt ausgewählt"),
    note: z.string().max(2000).default(""),
    notify_parents: z.boolean().default(true),
  })
  .refine(
    (o) =>
      Date.parse(o.ends_at) > Date.parse(o.starts_at) &&
      Date.parse(o.ends_at) - Date.parse(o.starts_at) <= 12 * 3600000,
    "Ungültige Dauer",
  );
export const attendanceSchema = z.object({
  participant: id,
  new_status: z.enum([
    "planned",
    "attended_manual",
    "absent",
    "excused",
    "cancelled",
  ]),
  reason,
  send_correction: z.boolean().default(false),
});
export const cancelSchema = z.object({ id, reason });
export const adminSchemas: Record<string, z.ZodType> = {
  players: z.object({
    id: id.optional(),
    first_name: name,
    last_name: name,
    birth_year: z.number().int().min(1990).max(2100).nullable().optional(),
    team: z.string().max(40),
    archived_at: z.iso.datetime().nullable().optional(),
  }),
  parents: z.object({
    id: id.optional(),
    full_name: name,
    contact_email: z.email(),
    billing_email: z
      .union([z.email(), z.literal("")])
      .transform((v) => v || null)
      .optional(),
    archived_at: z.iso.datetime().nullable().optional(),
  }),
  locations: z.object({
    id: id.optional(),
    name,
    address: z.string().min(3).max(300),
    active: z.boolean().optional(),
  }),
  plans: z.object({
    id: id.optional(),
    name: z.enum(["FirstTouch", "GameChanger", "Pro-Player", "NEXT LEVEL"]),
    stripe_price_id: z
      .string()
      .regex(/^price_/)
      .or(z.literal(""))
      .transform((v) => v || null),
    included_units: z.number().int().positive().max(12),
    athletics_units: z.number().int().min(0).max(4).default(0),
    generation: z.enum(["legacy", "current", "special"]).default("legacy"),
    billing_interval: z.enum(["month", "year"]).default("month"),
    active: z.boolean().optional(),
  }),
  staff_profiles: z.object({
    id,
    display_name: name,
    active: z.boolean().optional(),
  }),
  parent_players: z.object({ parent_id: id, player_id: id }),
  system_settings: z.object({
    key: z.literal("report_send_time"),
    value: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/),
  }),
};
export const importSchema = z.object({
  customer_id: z.string().startsWith("cus_"),
  subscription_id: z.string().startsWith("sub_"),
  item_id: z.string().startsWith("si_"),
  parent_id: id.optional(),
  parent_name: name,
  email: z.email(),
  player_id: id,
});

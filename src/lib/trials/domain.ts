import { z } from "zod";
export const TRIAL_CONTACT = {
  email: "contact@proacademy-ak.com",
  phone: "+49 151 433 423 92",
  tel: "+4915143342392",
  website: "https://proacademy-ak.com",
};
export const TRIAL_MATCH_MESSAGE = `Eine Online-Anfrage ist mit diesen Angaben nicht möglich. Bitte melde dich beim Team: ${TRIAL_CONTACT.email} oder ${TRIAL_CONTACT.phone}.`;
const name = z.string().trim().min(2).max(120);
export const trialApplicationSchema = z.object({
  request_id: z.uuid(),
  parent_name: name,
  email: z.email().trim().toLowerCase(),
  phone: z
    .string()
    .trim()
    .min(7)
    .max(40)
    .refine((v) => v.replace(/\D/g, "").length >= 7, "Telefonnummer prüfen."),
  children: z
    .array(
      z.object({
        first_name: name,
        last_name: name,
        birth_date: z.iso
          .date()
          .refine(
            (v) =>
              v >= "2000-01-01" && v <= new Date().toISOString().slice(0, 10),
            "Geburtsdatum prüfen.",
          ),
        club: z.string().trim().max(120).default(""),
      }),
    )
    .min(1)
    .max(3),
  preferred_location: z.string().trim().max(120).default(""),
  availability: z.string().trim().max(500).default(""),
  operational_consent: z.literal(true),
  privacy_acknowledged: z.literal(true),
  marketing_consent: z.boolean().default(false),
  website: z.string().max(0).default(""),
});
export const trialProfileFields = {
  first_name: name,
  last_name: name,
  birth_date: z.iso
    .date()
    .refine(
      (v) => v >= "2000-01-01" && v <= new Date().toISOString().slice(0, 10),
    ),
  team: z.string().trim().max(100),
  gender: z.enum(["", "männlich", "weiblich", "divers"]),
  club: z.string().trim().max(120),
  position: z.string().trim().max(80),
  strong_foot: z.enum(["", "rechts", "links", "beidfüßig"]),
  height_cm: z.number().int().min(50).max(250).nullable(),
  development_goals: z.string().trim().max(2000),
};
export const trialTeamSchema = z.discriminatedUnion("action", [
  z.object({
    action: z.literal("add_child"),
    family_id: z.uuid(),
    first_name: name,
    last_name: name,
    birth_date: trialProfileFields.birth_date,
    club: z.string().trim().max(120).default(""),
    reason: z.string().trim().min(5).max(500),
  }),
  z.object({ action: z.literal("resend"), request_id: z.uuid() }),
  z.object({
    action: z.literal("profile"),
    request_id: z.uuid(),
    ...trialProfileFields,
  }),
  z.object({
    action: z.literal("owner"),
    request_id: z.uuid(),
    assigned_to: z.uuid(),
  }),
  z.object({
    action: z.literal("attendance"),
    request_id: z.uuid(),
    status: z.enum(["attended_manual", "absent", "excused"]),
  }),
  z.object({
    action: z.literal("assign"),
    request_id: z.uuid(),
    event_id: z.uuid(),
  }),
  z.object({
    action: z.literal("note"),
    request_id: z.uuid(),
    note: z.string().trim().max(2000),
    status: z.enum(["new", "contacted", "closed"]),
  }),
  z.object({
    action: z.literal("review"),
    request_id: z.uuid(),
    event_id: z.uuid(),
    rating: z.number().int().min(1).max(5),
    feedback: z.string().trim().min(3).max(2000),
    ready: z.boolean(),
  }),
  z.object({
    action: z.literal("mark"),
    participant_id: z.uuid(),
    birth_date: z.iso
      .date()
      .refine(
        (v) => v >= "2000-01-01" && v <= new Date().toISOString().slice(0, 10),
        "Geburtsdatum prüfen.",
      )
      .optional(),
    operational_consent: z.literal(true),
    marketing_consent: z.boolean().default(false),
  }),
]);
export interface TrialRow {
  id: string;
  family_id: string;
  converted_at?: string | null;
  comment_submitted_at?: string | null;
  attendance_due_at?: string | null;
  feedback_due_at?: string | null;
  feedback_mail_status?: string | null;
  feedback_mail_error?: string | null;
  assigned_to?: string | null;
  assigned_name?: string | null;
  feedback_at?: string | null;
  converted_player_id?: string | null;
  team?: string;
  gender?: string | null;
  position?: string | null;
  strong_foot?: string | null;
  height_cm?: number | null;
  development_goals?: string | null;
  original_data?: Record<string, unknown>;

  player_id: string;
  first_name: string;
  last_name: string;
  birth_date: string;
  club: string;
  status: string;
  team_note: string;
  event_id: string | null;
  participant_id: string | null;
  confirmed_at: string | null;
  parent_name: string;
  email: string;
  phone: string;
  preferred_location: string;
  availability: string;
  email_verified: boolean;
  event_title: string | null;
  starts_at: string | null;
  ends_at: string | null;
  event_status: string | null;
  attendance: string | null;
  location_name: string | null;
  address: string | null;
  coach_name: string | null;
  academy_rating: number | null;
  academy_feedback: string | null;
  academy_ready: boolean;
  parent_rating: number | null;
  parent_feedback: string | null;
  subscribed: boolean;
}
export interface TrialCamp {
  id: string;
  title: string;
  location: string;
  starts_at: string;
}
export const TRIAL_MAIL_KINDS = [
  "trial_welcome",
  "trial_planning",
  "trial_reminder",
  "trial_cancelled",
  "trial_feedback",
  "trial_day7",
  "trial_day14",
  "trial_customer_planning",
  "trial_customer_reminder",
  "trial_customer_cancelled",
];

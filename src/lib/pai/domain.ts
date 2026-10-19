import { Temporal } from "@js-temporal/polyfill";
import { z } from "zod";
import { familyStatus } from "../parent-profile";
import { TIMEZONE } from "../domain";

const limit = z.number().int().min(0).max(1000);
export const configSchema = z
  .object({
    enabled: z.boolean(),
    bases: z
      .object({
        starter: limit,
        bronze: limit,
        silver: limit,
        gold: limit,
        ultimate: limit,
      })
      .strict(),
    factors: z
      .object({
        firsttouch: z.number().int().min(0).max(1000),
        gamechanger: z.number().int().min(0).max(1000),
        pro: z.number().int().min(0).max(1000),
        nextlevel: z.number().int().min(0).max(1000),
      })
      .strict(),
    coach: limit,
    admin: limit,
    monthlyFallback: limit,
    budgetUsd: z.number().min(0).max(10000),
    retentionDays: z.number().int().min(0).max(365),
    model: z.enum(["gpt-5.4-mini", "gpt-5.4-mini-2026-03-17"]),
  })
  .strict();
export type PaiConfig = z.infer<typeof configSchema>;
export const defaultConfig: PaiConfig = {
  enabled: true,
  bases: { starter: 3, bronze: 5, silver: 7, gold: 10, ultimate: 12 },
  factors: { firsttouch: 50, gamechanger: 70, pro: 100, nextlevel: 100 },
  coach: 10,
  admin: 15,
  monthlyFallback: 10,
  budgetUsd: 5,
  retentionDays: 30,
  model: "gpt-5.4-mini",
};
export type PlanGroup = keyof PaiConfig["factors"];
/** Only authoritative catalog names, never fuzzy matches against user/model text. */
export function planGroup(name: string): PlanGroup | null {
  return (
    (
      {
        FirstTouch: "firsttouch",
        GameChanger: "gamechanger",
        "Pro-Player": "pro",
        Pro: "pro",
        "NEXT LEVEL": "nextlevel",
      } as Record<string, PlanGroup>
    )[name] ?? null
  );
}
export function berlinWindow(
  kind: "day" | "month",
  now = new Date().toISOString(),
) {
  const date = Temporal.Instant.from(now).toZonedDateTimeISO(TIMEZONE);
  const start = (kind === "month" ? date.with({ day: 1 }) : date).startOfDay();
  const end =
    kind === "month" ? start.add({ months: 1 }) : start.add({ days: 1 });
  return {
    start: start.toInstant().toString(),
    reset: end.toInstant().toString(),
  };
}
export function allowance(
  role: string,
  months: number,
  groups: (PlanGroup | null)[],
  config: PaiConfig,
) {
  const badge = familyStatus(months);
  if (role !== "parent")
    return {
      kind: "day" as const,
      standard: role === "admin" ? config.admin : config.coach,
      badge: null,
      basis: null,
      factor: null,
      plan: null,
      explanation: `${role === "admin" ? "Admin" : "Coach"}: ${role === "admin" ? config.admin : config.coach} Fragen täglich.`,
    };
  if (!groups.length || groups.includes(null))
    return {
      kind: "month" as const,
      standard: config.monthlyFallback,
      badge: badge.label,
      basis: null,
      factor: null,
      plan: null,
      explanation: `${!groups.length ? "Kein aktives Abo" : "Tarifzuordnung unklar"}: ${config.monthlyFallback} Fragen pro Kalendermonat.`,
    };
  const plan = (groups as PlanGroup[]).reduce((a, b) =>
    config.factors[a] >= config.factors[b] ? a : b,
  );
  const basis = config.bases[badge.tier as keyof PaiConfig["bases"]],
    percent = config.factors[plan];
  const standard = Math.floor((basis * percent + 99) / 100);
  const label = badge.tier === "starter" ? "Kein Abzeichen" : badge.label;
  return {
    kind: "day" as const,
    standard,
    badge: label,
    basis,
    factor: percent / 100,
    plan,
    explanation: `${label} = ${basis} Basisfragen. ${{ firsttouch: "FirstTouch", gamechanger: "Gamechanger", pro: "Pro", nextlevel: "NextLevel" }[plan]} × ${(percent / 100).toLocaleString("de-DE")} = ${((basis * percent) / 100).toLocaleString("de-DE")}; aufgerundet ${standard} Fragen täglich.`,
  };
}
export type Allowance = ReturnType<typeof allowance>;
export const overrideSchema = z
  .object({
    userId: z.uuid(),
    limit,
    kind: z.enum(["day", "month"]),
    reason: z.string().trim().min(3).max(500),
    expiresAt: z.iso.datetime().nullable(),
    active: z.boolean(),
  })
  .strict();
export type PaiStatus = Allowance & {
  enabled: boolean;
  available: boolean;
  limit: number;
  used: number;
  reserved: number;
  remaining: number;
  reset: string;
  override: boolean;
  retentionDays: number;
  reason?: string;
};
export const disabledMessage =
  "Aktiviere mich in deinen Einstellungen, damit ich dir bei Fragen zu Trainings, Stempelkarten, Abonnements und deinem Mitgliedschaftsabzeichen weiterhelfen kann.";

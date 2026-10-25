import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
const m = vi.hoisted(() => ({
  rows: {} as Record<string, any[]>,
  reads: [] as string[],
  from: vi.fn(),
}));
vi.mock("../src/lib/server/service-db", () => ({
  serviceDb: () => ({ from: m.from }),
}));
vi.mock("../src/lib/server/profile-subscription-history", () => ({
  profileActivePeriods: async (_: unknown, periods: unknown) => periods,
}));
vi.mock("../src/lib/camps/runtime", () => ({
  campEnabled: () => false,
  campPaymentMode: () => "test",
}));
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh() {} }) }));
vi.mock("next/link", () => ({ default: "a" }));
import { loadParentProfile } from "../src/lib/server/parent-profile";
import { ProfileView } from "../src/components/parent-profile";
const parent = "10000000-0000-4000-8000-000000000001";
const foreign = "10000000-0000-4000-8000-000000000002";
const child = "10000000-0000-4000-8000-000000000003";
const session = {
  role: "parent",
  user: { id: parent },
  trialEnabled: true,
} as any;
beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date("2026-10-25T12:00:00Z"));
  m.reads = [];
  m.rows = {
    parents: [
      {
        id: parent,
        auth_user_id: parent,
        archived_at: null,
        full_name: "Testfamilie",
      },
    ],
    trial_players: [
      {
        id: child,
        first_name: "Ada",
        last_name: "Beispiel",
        birth_date: "2015-05-01",
        converted_at: null,
        converted_player_id: null,
        trial_families: {
          parent_id: parent,
          stopped_at: null,
          created_at: "2026-10-20T12:00:00Z",
        },
        trial_requests: { id: child, status: "planned", confirmed_at: null },
      },
    ],
  };
  m.from.mockImplementation((table: string) => {
    m.reads.push(table);
    const predicates: ((row: any) => boolean)[] = [];
    const value = (row: any, key: string) =>
      key.split(".").reduce((r, k) => r?.[k], row);
    const rows = () =>
      (m.rows[table] ?? []).filter((r) => predicates.every((p) => p(r)));
    const q: any = {
      select: () => q,
      order: () => q,
      limit: () => q,
      eq: (key: string, v: unknown) => {
        predicates.push((r) => value(r, key) === v);
        return q;
      },
      is: (key: string, v: unknown) => {
        predicates.push((r) => value(r, key) === v);
        return q;
      },
      gt: (key: string, v: string) => {
        predicates.push((r) => value(r, key) > v);
        return q;
      },
      in: (key: string, vs: unknown[]) => {
        predicates.push((r) => vs.includes(value(r, key)));
        return q;
      },
      maybeSingle: async () => ({ data: rows()[0] ?? null, error: null }),
      then: (resolve: (r: unknown) => unknown) =>
        Promise.resolve(resolve({ data: rows(), error: null })),
    };
    return q;
  });
});
afterEach(() => vi.useRealTimers());
it.each(["trial", "camp", "converted"])(
  "shows one child throughout %s without creating an entitlement or changing the regular list",
  async (phase) => {
    if (phase !== "trial")
      m.rows.parent_players = [
        {
          id: child,
          parent_id: parent,
          players: {
            id: child,
            first_name: "Ada",
            last_name: "Beispiel",
            birth_year: 2015,
            team: "",
            archived_at: null,
          },
        },
      ];
    if (phase === "converted")
      Object.assign(m.rows.trial_players[0], {
        converted_at: "2026-10-25T11:00:00Z",
        converted_player_id: child,
      });
    const profile = await loadParentProfile(session);
    expect(profile.children).toHaveLength(phase === "trial" ? 0 : 1);
    expect(profile.trial_children).toHaveLength(phase === "converted" ? 0 : 1);
    expect(profile.months).toBe(0);
    expect(profile.has_subscription_history).toBe(false);
    const html = renderToStaticMarkup(
      createElement(ProfileView, { initial: profile, base: "/profil" }),
    );
    expect(html.match(/<h3>Ada Beispiel<\/h3>/g)).toHaveLength(1);
    expect(html).toContain("1 Kind");
    expect(html).not.toContain("Noch keine Kinder zugeordnet.");
    expect(html.includes("premium-child trial")).toBe(phase !== "converted");
    expect(html.includes('href="/probetraining/willkommen"')).toBe(
      phase !== "converted",
    );
    if (phase === "trial") expect(m.reads).not.toContain("entitlement_periods");
  },
);
it("excludes other families, expired/stopped trials and honors the feature switch", async () => {
  const original = m.rows.trial_players[0];
  for (const change of [
    { parent_id: foreign },
    { stopped_at: "2026-10-24T12:00:00Z" },
    { created_at: "2026-01-01T12:00:00Z" },
  ])
    m.rows.trial_players.push({
      ...original,
      id: crypto.randomUUID(),
      trial_families: { ...original.trial_families, ...change },
    });
  expect(
    (await loadParentProfile(session)).trial_children?.map((c) => c.id),
  ).toEqual([child]);
  m.reads = [];
  expect(
    (await loadParentProfile({ ...session, trialEnabled: false }))
      .trial_children,
  ).toEqual([]);
  expect(m.reads).not.toContain("trial_players");
  await expect(loadParentProfile(session, foreign)).rejects.toThrow(
    "Profil nicht verfügbar",
  );
});

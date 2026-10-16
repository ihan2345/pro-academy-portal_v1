import { afterEach, beforeEach, expect, it, vi } from "vitest";
const state = vi.hoisted(() => ({
  tables: {} as Record<string, any[]>,
  reads: [] as { table: string; ids?: string[] }[],
  revenue: vi.fn(),
  backfillError: false,
}));
vi.mock("../src/lib/server/config", () => ({
  required: () => "player-profile-cursor-test-key-not-a-real-credential",
}));
afterEach(() => vi.useRealTimers());
vi.mock("../src/lib/server/service-db", () => ({
  serviceDb: () => ({
    from: (table: string) => {
      const filters: ((row: any) => boolean)[] = [];
      let limit = 500;
      const call: { table: string; ids?: string[] } = { table };
      state.reads.push(call);
      const nested = (row: any, key: string) =>
        key.split(".").reduce((v, k) => v?.[k], row);
      const q: any = {
        select: () => q,
        order: () => q,
        limit: (n: number) => {
          limit = n;
          return q;
        },
        in: (key: string, ids: string[]) => {
          call.ids = ids;
          filters.push((row) => ids.includes(nested(row, key)));
          return q;
        },
        eq: (key: string, value: any) => {
          filters.push((row) => nested(row, key) === value);
          return q;
        },
        is: (key: string, value: any) => {
          filters.push((row) => nested(row, key) === value);
          return q;
        },
        gt: (key: string, value: any) => {
          filters.push((row) => nested(row, key) > value);
          return q;
        },
        then: (resolve: any) =>
          Promise.resolve({
            data: (state.tables[table] ?? [])
              .filter((row) => filters.every((f) => f(row)))
              .sort((a, b) => a.id.localeCompare(b.id))
              .slice(0, limit),
            error:
              table === "training_backfills" && state.backfillError
                ? { code: "missing" }
                : null,
          }).then(resolve),
      };
      return q;
    },
  }),
}));
vi.mock("../src/lib/server/profile-subscription-history", () => ({
  profileActivePeriods: async (_: unknown, p: unknown) => p,
}));
vi.mock("../src/lib/server/profile-revenue", () => ({
  readParentRevenue: state.revenue,
}));
vi.mock("../src/lib/camps/runtime", () => ({
  campEnabled: () => false,
  campPaymentMode: () => "test",
}));
import { playerProfileList } from "../src/lib/server/player-profiles";
import { comparePlayerProfiles } from "../src/lib/player-profiles";
const session = (role = "admin", id = "user") =>
  ({ role, user: { id } }) as any;
beforeEach(() => {
  state.reads = [];
  state.backfillError = false;
  state.revenue.mockReset();
  const players = Array.from({ length: 25 }, (_, i) => ({
    id: `player-${String(i).padStart(2, "0")}`,
    first_name: `Kind ${String(i).padStart(2, "0")}`,
    last_name: "Test",
    birth_year: 2015,
    team: "U12",
    archived_at: null,
    created_at: new Date(2025, 0, i + 1).toISOString(),
  }));
  state.tables = {
    players,
    subscription_players: players.map((p, i) => ({
      id: `link-${i}`,
      player_id: p.id,
      players: p,
      subscriptions: { status: "active" },
    })),
    parent_players: players.map((p, i) => ({
      id: `parent-link-${i}`,
      player_id: p.id,
      parents: {
        id: `parent-${i}`,
        full_name: `Eltern ${i}`,
        contact_email: `eltern${i}@example.test`,
        archived_at: null,
      },
    })),
    entitlement_periods: [],
    event_participants: [],
    training_backfills: [],
  };
});
it("loads ten full cards, deduplicates subscriptions, and excludes inactive/archived children", async () => {
  state.tables.subscription_players.push({
    ...state.tables.subscription_players[0],
    id: "duplicate",
  });
  state.tables.players[24].archived_at = "2026-01-01";
  state.tables.subscription_players[23].subscriptions.status = "canceled";
  const first = await playerProfileList(session(), {});
  expect(first.rows).toHaveLength(10);
  expect(first.total).toBe(23);
  expect(new Set(first.rows.map((r) => r.id)).size).toBe(10);
  expect(
    state.reads
      .filter((r) =>
        ["players", "event_participants", "entitlement_periods"].includes(
          r.table,
        ),
      )
      .every((r) => r.ids?.length === 10),
  ).toBe(true);
  const second = await playerProfileList(session(), { cursor: first.next });
  const third = await playerProfileList(session(), { cursor: second.next });
  expect(second.rows).toHaveLength(10);
  expect(third.rows).toHaveLength(3);
  expect(third.next).toBeNull();
  expect(
    new Set([...first.rows, ...second.rows, ...third.rows].map((r) => r.id))
      .size,
  ).toBe(23);
});
it("protects staff finance access and user-scoped cursors before reading data", async () => {
  await expect(playerProfileList(session("parent"), {})).rejects.toMatchObject({
    status: 403,
  });
  await expect(
    playerProfileList(session("staff"), { sort: "revenue" }),
  ).rejects.toMatchObject({ status: 403 });
  expect(state.reads).toHaveLength(0);
  const page = await playerProfileList(session(), {});
  await expect(
    playerProfileList(session("admin", "other"), { cursor: page.next }),
  ).rejects.toMatchObject({ status: 409 });
  await expect(
    playerProfileList(session(), { sort: "newest", cursor: page.next }),
  ).rejects.toMatchObject({ status: 409 });
});
it("sorts training time globally before pagination and includes backfills", async () => {
  state.tables.training_backfills = [
    {
      id: "backfill",
      player_id: "player-24",
      title: "Nachtrag",
      event_type: "training",
      occurred_on: "2026-01-01",
      duration_minutes: 120,
    },
  ];
  const page = await playerProfileList(session(), { sort: "hours" });
  expect(page.rows[0].id).toBe("player-24");
  expect(page.rows[0].stats.all.minutes).toBe(120);
});
it("rejects incomplete training rankings rather than returning false zeroes", async () => {
  state.backfillError = true;
  await expect(
    playerProfileList(session(), { sort: "hours" }),
  ).rejects.toMatchObject({ status: 503 });
});
it("searches children and parent email, and marks unknown revenue last", async () => {
  const page = await playerProfileList(session(), { search: "eltern24@" });
  expect(page.rows.map((r) => r.id)).toEqual(["player-24"]);
  expect(
    comparePlayerProfiles(
      { id: "a", name: "A", created: "", rank: null },
      { id: "b", name: "B", created: "", rank: 0 },
      "revenue",
    ),
  ).toBeGreaterThan(0);
});
it("rechecks archived children between pages", async () => {
  const first = await playerProfileList(session(), {});
  state.tables.players[10].archived_at = "2026-01-01";
  const second = await playerProfileList(session(), { cursor: first.next });
  expect(second.rows.some((r) => r.id === "player-10")).toBe(false);
});

it("allows staff to read the player directory", async () => {
  const page = await playerProfileList(session("staff"), {});
  expect(page.rows).toHaveLength(10);
});
it("orders active subscription tiers globally with the highest tier first", async () => {
  state.tables.entitlement_periods = [
    ["player-24", "Pro", "active"],
    ["player-23", "Gamechanger", "active"],
    ["player-22", "First Touch", "active"],
    ["player-23", "Firsttouch", "active"],
    ["player-00", "Pro", "cancelled"],
  ].map(([player_id, product_name, status], i) => ({
    id: `tier-${i}`,
    player_id,
    product_name,
    status,
    starts_at: "2020-01-01",
    ends_at: "2099-01-01",
  }));
  const page = await playerProfileList(session(), { sort: "subscription" });
  expect(page.rows.slice(0, 3).map((r) => r.id)).toEqual([
    "player-24",
    "player-23",
    "player-22",
  ]);
});

it("loads all 93 players across fresh workers and expired ranking caches", async () => {
  const template = state.tables.players[0];
  state.tables.players = Array.from({ length: 93 }, (_, i) => ({
    ...template,
    id: `child-${String(i).padStart(3, "0")}`,
    first_name: `Kind ${String(i).padStart(3, "0")}`,
  }));
  state.tables.subscription_players = state.tables.players.map((p, i) => ({
    id: `subscription-${i}`,
    player_id: p.id,
    players: p,
    subscriptions: { status: "active" },
  }));
  let page = await playerProfileList(session(), {});
  const ids = page.rows.map((r) => r.id);
  vi.useFakeTimers();
  while (page.next) {
    // Independent module state simulates routing to another Cloudflare isolate.
    vi.resetModules();
    vi.setSystemTime(Date.now() + 6 * 60_000);
    const worker = await import("../src/lib/server/player-profiles");
    page = await worker.playerProfileList(session(), { cursor: page.next });
    expect(page.rows.length).toBeLessThanOrEqual(10);
    ids.push(...page.rows.map((r) => r.id));
    expect(ids.length).toBeLessThanOrEqual(93);
  }
  expect(ids).toEqual(state.tables.players.map((p) => p.id));
  expect(new Set(ids).size).toBe(93);
});
it("resumes after a cache timeout even when the last loaded child was removed", async () => {
  vi.useFakeTimers();
  const first = await playerProfileList(session(), {});
  state.tables.players[9].archived_at = "2026-01-01";
  vi.setSystemTime(Date.now() + 6 * 60_000);
  const next = await playerProfileList(session(), { cursor: first.next });
  expect(next.rows.map((p) => p.id)).toEqual(
    state.tables.players.slice(10, 20).map((p) => p.id),
  );
});
it("rejects tampered continuations before reading profile data", async () => {
  const first = await playerProfileList(session(), {});
  const token = first.next!;
  const changed =
    token.slice(0, 35) + (token[35] === "A" ? "B" : "A") + token.slice(36);
  state.reads = [];
  await expect(
    playerProfileList(session(), { cursor: changed }),
  ).rejects.toMatchObject({ status: 409 });
  expect(state.reads).toHaveLength(0);
});
it.each([
  "name",
  "newest",
  "subscription",
  "hours",
  "months",
  "revenue",
] as const)("continues %s ordering on another worker", async (sort) => {
  state.revenue.mockResolvedValue(new Map());
  const first = await playerProfileList(session(), { sort });
  const warm = await playerProfileList(session(), { sort, cursor: first.next });
  vi.resetModules();
  const worker = await import("../src/lib/server/player-profiles");
  const cold = await worker.playerProfileList(session(), {
    sort,
    cursor: first.next,
  });
  expect(cold.rows.map((p) => p.id)).toEqual(warm.rows.map((p) => p.id));
});

import { beforeEach, expect, it, vi } from "vitest";
const m = vi.hoisted(() => ({ enabled: vi.fn(), from: vi.fn() }));
vi.mock("../src/lib/server/pai/service", () => ({
  enabled: m.enabled,
  checked: (r: any) => {
    if (r.error) throw Error("unavailable");
    return r.data;
  },
  context: vi.fn(),
  membership: vi.fn(),
}));
import { executeTool } from "../src/lib/server/pai/tools";
const ids = [
  "10000000-0000-4000-8000-000000000001",
  "10000000-0000-4000-8000-000000000002",
];
const calls: any[] = [];
function query(table: string) {
  const filters: any[] = [];
  const q: any = {};
  for (const key of [
    "select",
    "eq",
    "is",
    "order",
    "limit",
    "neq",
    "lte",
    "gte",
    "gt",
  ])
    q[key] = (...args: any[]) => {
      filters.push([key, ...args]);
      return q;
    };
  const result = () => {
    calls.push({ table, filters });
    const id = filters.find((f) => f[0] === "eq" && f[1] === "id")?.[2];
    if (table === "players")
      return {
        data: id
          ? { id }
          : ids.map((id, i) => ({
              id,
              first_name: ["Mila", "Leon"][i],
              last_name: "Test",
            })),
      };
    return { data: [] };
  };
  q.maybeSingle = async () => result();
  q.then = (resolve: any) => Promise.resolve(result()).then(resolve);
  return q;
}
beforeEach(() => {
  vi.resetAllMocks();
  calls.length = 0;
  m.enabled.mockResolvedValue(true);
  m.from.mockImplementation(query);
});
const session = (role: string): any => ({
  role,
  user: { id: "parent" },
  db: { from: m.from },
});
it("automatically retrieves units for both assigned children without user IDs", async () => {
  const result = await executeTool(
    session("parent"),
    "get_subscription_summary",
    { player_id: null },
  );
  expect(result.children.map((c: any) => c.name)).toEqual([
    "Mila Test",
    "Leon Test",
  ]);
  expect(
    calls
      .filter((c) => c.table === "entitlement_periods")
      .map((c) => c.filters.find((f: any) => f[1] === "player_id")[2]),
  ).toEqual(ids);
  expect(calls.some((c) => c.table === "training_events")).toBe(false);
});
it("uses the same family scope for general training questions", async () => {
  const result = await executeTool(session("parent"), "get_training_history", {
    player_id: null,
  });
  expect(result.children).toHaveLength(2);
  expect(calls.filter((c) => c.table === "event_participants")).toHaveLength(2);
});
it.each(["coach", "admin"])(
  "provides academy past and upcoming training for %s",
  async (role) => {
    const result = await executeTool(session(role), "get_training_history", {
      player_id: null,
    });
    expect(result.scope).toBe("Academy");
    expect(calls.filter((c) => c.table === "training_events")).toHaveLength(2);
    expect(
      calls.every((c) =>
        c.filters.some((f: any) => f[0] === "neq" && f[2] === "cancelled"),
      ),
    ).toBe(true);
  },
);
it("does not expose admin statistics to parents or coaches", async () => {
  for (const role of ["parent", "coach"])
    await expect(
      executeTool(session(role), "get_admin_statistics", {}),
    ).rejects.toThrow("nicht erlaubt");
  expect(m.from).not.toHaveBeenCalled();
});

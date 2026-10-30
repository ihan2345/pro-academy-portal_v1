import { beforeEach, expect, it, vi } from "vitest";
const f = vi.hoisted(() => ({
  role: "admin",
  camp: { status: "draft" },
  offers: [] as any[],
  result: {} as any,
  filters: [] as any[],
  delete: vi.fn(),
}));
vi.mock("../src/lib/camps/service", () => ({
  campSession: async () => ({ role: f.role }),
  getCamp: async () => ({ camp: f.camp, offers: f.offers }),
}));
vi.mock("../src/lib/server/service-db", () => ({
  serviceDb: () => ({
    from: () => {
      const q: any = {
        delete: () => {
          f.delete();
          return q;
        },
        eq: (key: string, value: string) => {
          f.filters.push([key, value]);
          return q;
        },
        select: () => q,
        maybeSingle: async () => f.result,
      };
      return q;
    },
  }),
}));
import { deleteUnusedCamp } from "../src/lib/camps/management";
const id = "6d194608-892a-4167-8549-3e3f414a1d50";
beforeEach(() => {
  vi.clearAllMocks();
  f.role = "admin";
  f.camp = { status: "draft" };
  f.offers = [];
  f.filters = [];
  f.result = { data: { id }, error: null };
});
it.each(["staff", "parent"])("does not let %s delete camps", async (role) => {
  f.role = role;
  await expect(deleteUnusedCamp(id)).rejects.toMatchObject({ status: 403 });
  expect(f.delete).not.toHaveBeenCalled();
});
it.each(["open", "closed", "archived"])(
  "retains %s camps for archiving instead of deleting their records",
  async (status) => {
    f.camp.status = status;
    await expect(deleteUnusedCamp(id)).rejects.toMatchObject({ status: 409 });
    expect(f.delete).not.toHaveBeenCalled();
  },
);
it("retains a draft with Stripe offers", async () => {
  f.offers = [{ id: "offer" }];
  await expect(deleteUnusedCamp(id)).rejects.toThrow("Zahlungsangebote");
  expect(f.delete).not.toHaveBeenCalled();
});
it("deletes only an unused draft, with a status condition on the mutation", async () => {
  await expect(deleteUnusedCamp(id)).resolves.toMatchObject({ ok: true });
  expect(f.filters).toEqual([
    ["id", id],
    ["status", "draft"],
  ]);
});
it("reports linked bookings/payments without deleting them or retrying a cascade", async () => {
  f.result = { data: null, error: { code: "23503" } };
  await expect(deleteUnusedCamp(id)).rejects.toMatchObject({ status: 409 });
  expect(f.delete).toHaveBeenCalledTimes(1);
});
it("does not claim deletion when the camp changed concurrently", async () => {
  f.result = { data: null, error: null };
  await expect(deleteUnusedCamp(id)).rejects.toThrow("inzwischen verändert");
});

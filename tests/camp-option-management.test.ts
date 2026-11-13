import { beforeEach, expect, it, vi } from "vitest";
const m = vi.hoisted(() => ({
  role: "admin",
  session: vi.fn(),
  getCamp: vi.fn(),
  update: vi.fn(),
  eq: vi.fn(),
  result: { data: { id: "camp" }, error: null } as any,
}));
vi.mock("../src/lib/camps/service", () => ({
  campSession: m.session,
  getCamp: m.getCamp,
}));
vi.mock("../src/lib/server/service-db", () => ({
  serviceDb: () => ({
    from: () => {
      const q: any = {
        update: (v: any) => {
          m.update(v);
          return q;
        },
        eq: (...args: any[]) => {
          m.eq(...args);
          return q;
        },
        select: () => q,
        maybeSingle: async () => m.result,
      };
      return q;
    },
  }),
}));
import { saveCampBookingOption } from "../src/lib/camps/management";
const body = {
  camp_id: "90000000-0000-4000-8000-000000000001",
  expected_version: 2,
  booking_option: {
    amount: 7900,
    title: "Tagesoption",
    description: "Ein Tag",
    alert: "Abstimmen",
  },
};
beforeEach(() => {
  vi.resetAllMocks();
  m.result = { data: { id: "camp" }, error: null };
  m.session.mockResolvedValue({ role: "admin" });
  m.getCamp.mockResolvedValue({ camp: { payment_mode: "test" } });
});
it("updates only the chosen Camp in its mode and at the expected version", async () => {
  expect(await saveCampBookingOption(body)).toEqual({ ok: true });
  expect(m.session).toHaveBeenCalledWith(true);
  expect(m.getCamp).toHaveBeenCalledWith(body.camp_id);
  expect(m.update).toHaveBeenCalledWith({
    booking_option: body.booking_option,
  });
  expect(m.eq.mock.calls).toEqual([
    ["payment_mode", "test"],
    ["id", body.camp_id],
    ["booking_option_version", 2],
  ]);
});
it("allows disabling centrally without changing Camp status or prices", async () => {
  await saveCampBookingOption({ ...body, booking_option: null });
  expect(m.update).toHaveBeenCalledWith({ booking_option: null });
});
it("fails on lost updates", async () => {
  m.result = { data: null, error: null };
  await expect(saveCampBookingOption(body)).rejects.toMatchObject({
    status: 409,
  });
});
it("retains the team permission and mode checks before mutation", async () => {
  m.session.mockRejectedValue({ status: 403 });
  await expect(saveCampBookingOption(body)).rejects.toMatchObject({
    status: 403,
  });
  expect(m.update).not.toHaveBeenCalled();
  m.session.mockResolvedValue({ role: "staff" });
  m.getCamp.mockRejectedValue({ status: 404 });
  await expect(saveCampBookingOption(body)).rejects.toMatchObject({
    status: 404,
  });
  expect(m.update).not.toHaveBeenCalled();
});

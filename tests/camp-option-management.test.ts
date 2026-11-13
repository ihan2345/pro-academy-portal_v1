import { beforeEach, describe, expect, it, vi } from "vitest";
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
        is: (...args: any[]) => {
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
import { campEditState } from "../src/lib/camps/domain";
import { updateCamp, saveCampBookingOption } from "../src/lib/camps/management";
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

describe("Camp settings editing", () => {
  const camp = {
    id: body.camp_id,
    payment_mode: "test" as const,
    title: "Bestehendes Camp",
    location: "Testplatz",
    description: "Beschreibung",
    capacity: 30,
    buffer_percent: 10,
    min_age: 6,
    max_age: 16,
    status: "open",
    days: [
      { starts_at: "2027-04-01T09:00:00Z", ends_at: "2027-04-01T15:00:00Z" },
    ],
    early_bird_until: null,
    booking_option_version: 2,
    booking_option: body.booking_option,
    member_benefits_enabled: false,
  };
  const edit = () => ({
    ...camp,
    title: "Neuer Camptitel",
    expected_state: JSON.stringify(campEditState(camp)),
    main_amount: 100,
  });
  beforeEach(() => {
    m.getCamp.mockResolvedValue({
      camp,
      offers: [{ kind: "main", amount: 9900 }],
      occupied: 5,
    });
  });
  it("updates settings for the selected Camp without writing offers, prices or bookings", async () => {
    await expect(updateCamp(edit())).resolves.toEqual({ ok: true });
    expect(m.session).toHaveBeenCalledWith(true);
    const values = m.update.mock.calls[0][0];
    expect(values).toMatchObject({
      title: "Neuer Camptitel",
      days: camp.days,
      status: "open",
      member_benefits_enabled: false,
    });
    expect(values).not.toHaveProperty("id");
    expect(values).not.toHaveProperty("main_amount");
    expect(values).not.toHaveProperty("main");
    expect(m.eq).toHaveBeenCalledWith("id", camp.id);
    expect(m.eq).toHaveBeenCalledWith("payment_mode", "test");
    expect(m.eq).toHaveBeenCalledWith("days", JSON.stringify(camp.days));
  });
  it("rejects a stale form before writing and a simultaneous change at update", async () => {
    await expect(
      updateCamp({ ...edit(), expected_state: "outdated" }),
    ).rejects.toMatchObject({ status: 409 });
    expect(m.update).not.toHaveBeenCalled();
    m.result = { data: null, error: null };
    await expect(updateCamp(edit())).rejects.toMatchObject({ status: 409 });
  });
  it("retains team permission checks", async () => {
    m.session.mockRejectedValue({ status: 403 });
    await expect(updateCamp(edit())).rejects.toMatchObject({ status: 403 });
    expect(m.update).not.toHaveBeenCalled();
  });
  it("rejects capacity below occupied seats and opening without offers", async () => {
    await expect(
      updateCamp({ ...edit(), capacity: 1, buffer_percent: 0 }),
    ).rejects.toMatchObject({ status: 409 });
    m.getCamp.mockResolvedValue({ camp, offers: [], occupied: 5 });
    await expect(updateCamp(edit())).rejects.toMatchObject({ status: 400 });
    expect(m.update).not.toHaveBeenCalled();
  });
  it("validates days and age limits", async () => {
    await expect(updateCamp({ ...edit(), days: [] })).rejects.toThrow();
    await expect(
      updateCamp({ ...edit(), min_age: 20, max_age: 10 }),
    ).rejects.toThrow();
    expect(m.update).not.toHaveBeenCalled();
  });
});

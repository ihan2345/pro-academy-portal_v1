import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
const fixture = vi.hoisted(() => ({
  tables: {} as Record<string, unknown[]>,
  rpc: vi.fn(),
  confirm: vi.fn(),
  collect: vi.fn(),
  retrieve: vi.fn(),
  list: vi.fn(),
  upsert: vi.fn(),
  operations: [] as string[],
}));
vi.mock("../src/lib/server/service-db", () => ({
  serviceDb: () => ({
    from(table: string) {
      let data = fixture.tables[table] ?? [];
      const chain = {
        select() {
          return chain;
        },
        eq(field: string, value: unknown) {
          data = data.filter(
            (row) => (row as Record<string, unknown>)[field] === value,
          );
          return chain;
        },
        in(field: string, values: unknown[]) {
          data = data.filter((row) =>
            values.includes((row as Record<string, unknown>)[field]),
          );
          return chain;
        },
        maybeSingle() {
          return Promise.resolve({ data: data[0] ?? null, error: null });
        },
        upsert: fixture.upsert,
        delete() {
          fixture.operations.push(`delete:${table}`);
          return chain;
        },
        then(resolve: (value: unknown) => unknown) {
          return Promise.resolve({ data, error: null }).then(resolve);
        },
      };
      return chain;
    },
    rpc: fixture.rpc,
  }),
}));
vi.mock("../src/lib/camps/service", () => ({
  confirmPayment: fixture.confirm,
}));
vi.mock("../scripts/camp/stripe-review-lib.mjs", () => ({
  collectCampReview: fixture.collect,
}));
vi.mock("stripe", () => ({
  default: class {
    checkout = { sessions: { retrieve: fixture.retrieve, list: fixture.list } };
  },
}));
import {
  enqueueCampEvent,
  runCampProcessing,
} from "../src/lib/camps/processing";
import type Stripe from "stripe";
import { HttpError } from "../src/lib/server/security";
const camp = "e0000000-0000-4000-8000-000000000001",
  booking = "e0000000-0000-4000-8000-000000000002";
const source = {
  camp_id: camp,
  payment_link_id: "plink_live",
  price_id: "price_live",
  product_id: "prod_live",
};
const event = {
  id: "evt_live",
  type: "checkout.session.completed",
  livemode: true,
  data: { object: { id: "cs_live_paid" } },
} as Stripe.Event;
beforeEach(() => {
  vi.stubEnv("NODE_ENV", "production");
  vi.stubEnv("CAMP_LOCAL_ENABLED", "false");
  vi.stubEnv("CAMP_DEPLOYMENT_ENABLED", "true");
  vi.stubEnv("CAMP_PUBLIC_ORIGIN", "https://camp.example.invalid");
  vi.stubEnv("CAMP_REVIEW_ENABLED", "true");
  vi.stubEnv("CAMP_PROCESSING_ENABLED", "true");
  vi.stubEnv("CAMP_SIDE_EFFECTS_BLOCKED", "false");
  vi.stubEnv("CAMP_STRIPE_MODE", "live");
  vi.stubEnv("CAMP_STRIPE_READ_KEY", "rk_live_testonly");
  fixture.operations = [];
  fixture.rpc.mockReset().mockResolvedValue({ data: true, error: null });
  fixture.upsert.mockReset().mockResolvedValue({ data: null, error: null });
  fixture.confirm.mockReset().mockResolvedValue({ status: "paid" });
  fixture.tables = {
    camps: [{ id: camp, payment_mode: "live" }],
    camp_stripe_sources: [source],
    camp_offers: [],
    camp_bookings: [],
  };
  fixture.retrieve.mockReset().mockResolvedValue({
    id: "cs_live_paid",
    livemode: true,
    mode: "payment",
    payment_link: "plink_live",
  });
  fixture.collect.mockReset().mockResolvedValue({
    records: [
      {
        ...source,
        payment_id: "pi_live",
        session_id: "cs_live_paid",
        booking_reference: null,
        status: "paid",
        child_name: "Child",
        issues: [],
      },
    ],
  });
});
afterEach(() => vi.unstubAllEnvs());
describe("separate Camp processing", () => {
  it("fails closed without explicit enablement, before database or Stripe work", async () => {
    vi.stubEnv("CAMP_PROCESSING_ENABLED", "false");
    await expect(runCampProcessing()).rejects.toThrow("nicht freigegeben");
    expect(fixture.rpc).not.toHaveBeenCalled();
    expect(fixture.collect).not.toHaveBeenCalled();
  });
  it("queues only approved live Camp events and stores references, not the Stripe payload", async () => {
    expect(await enqueueCampEvent({ ...event, livemode: false })).toEqual({
      ignored: true,
    });
    fixture.retrieve.mockResolvedValueOnce({
      id: "cs_live_other",
      livemode: true,
      mode: "payment",
      payment_link: "plink_other",
    });
    expect(await enqueueCampEvent(event)).toEqual({ ignored: true });
    expect(fixture.upsert).not.toHaveBeenCalled();
    expect(await enqueueCampEvent(event)).toEqual({ received: true });
    expect(fixture.upsert).toHaveBeenCalledWith(
      {
        event_id: "evt_live",
        camp_id: camp,
        payment_link_id: "plink_live",
        session_id: "cs_live_paid",
      },
      { onConflict: "event_id", ignoreDuplicates: true },
    );
  });
  it("does not acknowledge a database outage", async () => {
    fixture.upsert.mockResolvedValue({
      data: null,
      error: { message: "offline" },
    });
    await expect(enqueueCampEvent(event)).rejects.toThrow("Datenbankzugriff");
  });
  it("leaves direct bookings for admin review and reuses confirmation only for a matching portal draft", async () => {
    await runCampProcessing();
    expect(fixture.confirm).not.toHaveBeenCalled();
    fixture.tables.camp_bookings = [
      {
        id: booking,
        camp_id: camp,
        booking_origin: "checkout",
        stripe_payment_link_id: "plink_live",
        child_data: { first_name: "Portal", last_name: "Child" },
      },
    ];
    fixture.collect.mockResolvedValue({
      records: [
        {
          ...source,
          session_id: "cs_live_paid",
          booking_reference: booking,
          status: "review",
          child_name: "",
          issues: ["Kindesname fehlt"],
        },
      ],
    });
    await runCampProcessing();
    expect(fixture.confirm).toHaveBeenCalledWith("cs_live_paid", true);
    expect(fixture.rpc).toHaveBeenCalledWith(
      "camp_store_review",
      expect.objectContaining({
        rows: [
          expect.objectContaining({
            child_name: "Portal Child",
            status: "paid",
            issues: [],
          }),
        ],
        failure: null,
      }),
    );
  });
  it("retains a conflicting payment for review without blocking other payments", async () => {
    fixture.tables.camp_bookings = [
      {
        id: booking,
        camp_id: camp,
        booking_origin: "checkout",
        stripe_payment_link_id: "plink_live",
        child_data: {},
      },
    ];
    fixture.collect.mockResolvedValue({
      records: [
        {
          ...source,
          session_id: "cs_live_conflict",
          booking_reference: booking,
          status: "paid",
          issues: [],
        },
      ],
    });
    fixture.confirm.mockRejectedValue(new HttpError(400, "Payment mismatch"));
    expect((await runCampProcessing()).failed).toBe(0);
    expect(fixture.rpc).toHaveBeenCalledWith(
      "camp_store_review",
      expect.objectContaining({
        rows: [
          expect.objectContaining({
            status: "review",
            issues: [expect.any(String)],
          }),
        ],
        failure: null,
      }),
    );
  });
  it("rejects unrelated references and overlapping runs", async () => {
    fixture.rpc.mockResolvedValueOnce({ data: false, error: null });
    expect((await runCampProcessing()).busy).toBe(true);
    expect(fixture.collect).not.toHaveBeenCalled();
    fixture.collect.mockResolvedValue({
      records: [
        {
          ...source,
          session_id: "cs_live_paid",
          booking_reference: booking,
          status: "paid",
          issues: [],
        },
      ],
    });
    fixture.tables.camp_bookings = [
      {
        id: booking,
        camp_id: camp,
        booking_origin: "checkout",
        stripe_payment_link_id: "plink_elsewhere",
      },
    ];
    await runCampProcessing();
    expect(fixture.confirm).not.toHaveBeenCalled();
  });
  it("preserves the prior snapshot on an incomplete Stripe scan and releases its lease", async () => {
    fixture.collect.mockRejectedValue(new Error("Stripe offline"));
    expect((await runCampProcessing()).failed).toBe(1);
    expect(fixture.rpc).toHaveBeenCalledWith(
      "camp_store_review",
      expect.objectContaining({ rows: [], failure: expect.any(String) }),
    );
    expect(fixture.operations).toContain("delete:camp_processing_lease");
  });
});

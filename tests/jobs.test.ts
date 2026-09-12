import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { runJobs, processMail } from "../workers/jobs";
import { jobMode } from "../workers/job-mode";

const mocks = vi.hoisted(() => ({
  stripe: vi.fn(),
  reports: vi.fn(),
  db: { from: vi.fn(), rpc: vi.fn() },
  finish: vi.fn(),
}));
vi.mock("../src/lib/server/service-db", () => ({ serviceDb: () => mocks.db }));
vi.mock("../src/lib/server/stripe", () => ({
  processStripeInbox: mocks.stripe,
}));
vi.mock("../src/lib/server/reports", () => ({ processReports: mocks.reports }));

beforeEach(() => {
  vi.resetAllMocks();
  vi.stubEnv("JOBS_ENABLED", "false");
  vi.stubEnv("STRIPE_SYNC_ONLY", "true");
  mocks.stripe.mockResolvedValue(3);
  mocks.finish.mockReturnValue({ eq: vi.fn(async () => ({ error: null })) });
  mocks.db.from.mockImplementation((table: string) => {
    if (table !== "job_runs") throw new Error(`Unexpected write: ${table}`);
    return {
      insert: () => ({
        select: () => ({
          single: async () => ({ data: { id: "run" }, error: null }),
        }),
      }),
      update: mocks.finish,
    };
  });
});
afterEach(() => vi.unstubAllEnvs());

it("processes only Stripe, leaving all notification and visibility tables untouched", async () => {
  expect(await runJobs()).toEqual({ ok: true, mode: "stripe-only", stripe: 3 });
  expect(mocks.stripe).toHaveBeenCalledOnce();
  expect(mocks.reports).not.toHaveBeenCalled();
  expect(mocks.db.rpc).not.toHaveBeenCalled();
  expect(mocks.db.from.mock.calls).toEqual([["job_runs"], ["job_runs"]]);
  expect(mocks.finish).toHaveBeenCalledWith({
    status: "completed",
    result: { mode: "stripe-only", stripe: 3 },
    error: null,
  });
});

it("does not fall through to other phases when Stripe fails", async () => {
  mocks.stripe.mockRejectedValue(new Error("Stripe unavailable"));
  expect(await runJobs()).toEqual({
    ok: false,
    mode: "stripe-only",
    stripe: "Stripe unavailable",
  });
  expect(mocks.reports).not.toHaveBeenCalled();
  expect(mocks.db.rpc).not.toHaveBeenCalled();
  expect(mocks.finish).toHaveBeenCalledWith(
    expect.objectContaining({ status: "failed" }),
  );
});

it("keeps the restricted mode even if the broad switch is also enabled", async () => {
  vi.stubEnv("JOBS_ENABLED", "true");
  expect(await runJobs()).toEqual({ ok: true, mode: "stripe-only", stripe: 3 });
  expect(mocks.db.rpc).not.toHaveBeenCalled();
  expect(mocks.reports).not.toHaveBeenCalled();
});

it("blocks direct mail processing before claiming or sending anything", async () => {
  const provider = { name: "proton", send: vi.fn() };
  await expect(processMail(provider)).rejects.toThrow(
    "disabled in Stripe-only",
  );
  expect(provider.send).not.toHaveBeenCalled();
  expect(mocks.db.rpc).not.toHaveBeenCalled();
  expect(mocks.db.from).not.toHaveBeenCalled();
});

it("requires an explicit switch, including for direct runner calls", async () => {
  vi.stubEnv("STRIPE_SYNC_ONLY", "false");
  await expect(runJobs()).rejects.toThrow("Background jobs disabled");
  expect(mocks.db.from).not.toHaveBeenCalled();
  expect(mocks.stripe).not.toHaveBeenCalled();
  expect(jobMode({})).toBe("disabled");
  expect(jobMode({ JOBS_ENABLED: "true" })).toBe("all");
  expect(jobMode({ STRIPE_SYNC_ONLY: "TRUE" })).toBe("disabled");
});

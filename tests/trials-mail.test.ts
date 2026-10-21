import { beforeEach, afterEach, it, expect, vi } from "vitest";
const mocks = vi.hoisted(() => ({ rpc: vi.fn(), from: vi.fn() }));
vi.mock("../src/lib/server/service-db", () => ({ serviceDb: () => mocks }));
import {
  composeTrialMail,
  planTrialNotifications,
} from "../workers/trial-notifications";
import { processMail } from "../workers/jobs";
const family = "b0000000-0000-4000-8000-000000000010";
const job = {
  id: "job",
  lease_token: "lease",
  attempts: 1,
  recipient: "parent@test.invalid",
  kind: "trial_feedback",
  payload: { family_id: family, request_id: "request", event_id: "event" },
};
beforeEach(() => {
  vi.resetAllMocks();
  vi.stubEnv("TRIAL_TRAINING_ENABLED", "true");
  vi.stubEnv("APP_URL", "https://portal.test.invalid");
  vi.stubEnv("SUPABASE_SERVICE_ROLE_KEY", "a".repeat(64));
  vi.stubEnv("MAIL_PROVIDER", "capture");
  vi.stubEnv("STRIPE_SYNC_ONLY", "false");
  mocks.rpc.mockResolvedValue({ data: true, error: null });
  mocks.from.mockImplementation((table: string) => {
    const chain = {
      select: () => chain,
      eq: () => chain,
      single: async () => ({
        data:
          table === "trial_families"
            ? {
                id: family,
                parent_name: "Mina",
                email: job.recipient,
                marketing_consent: true,
              }
            : {
                first_name: "Emir",
                last_name: "Beispiel",
                academy_rating: 4,
                academy_feedback: "Gute Ballkontrolle. Weiter so!",
                subscribed: false,
                starts_at: "2026-10-20T12:00:00Z",
                ends_at: "2026-10-20T13:00:00Z",
                location_name: "Sportplatz",
                address: "Weg 1",
                coach_name: "Coach",
              },
        error: null,
      }),
    };
    return chain;
  });
});
afterEach(() => vi.unstubAllEnvs());
it("sends the actual coach feedback and a secure rating link, without internal notes", async () => {
  const mail = await composeTrialMail(job);
  expect(mail.text).toContain("Gute Ballkontrolle. Weiter so!");
  expect(mail.text).toContain("Bewertung: 4 von 5");
  expect(mail.html).toContain("Probetraining bewerten");
  expect(mail.text).toContain("/probetraining/willkommen?token=");
  expect(mail.text).not.toContain("undefined");
});
it("rechecks eligibility immediately before sending and holds a message when an Abo or consent changes", async () => {
  let calls = 0;
  mocks.rpc.mockImplementation(async (name: string) => ({
    error: null,
    data:
      name === "claim_notifications"
        ? [job]
        : name === "trial_delivery_allowed"
          ? ++calls < 3
          : name === "email_job_preference_allows"
            ? true
            : null,
  }));
  const provider = { name: "proton", send: vi.fn() };
  expect(await processMail(provider)).toBe(0);
  expect(provider.send).not.toHaveBeenCalled();
  expect(mocks.rpc).toHaveBeenCalledWith(
    "finish_notification",
    expect.objectContaining({
      input: expect.objectContaining({ status: "held" }),
    }),
  );
});
it("does not plan or send trial messages when the local feature is disabled", async () => {
  vi.stubEnv("TRIAL_TRAINING_ENABLED", "false");
  expect(await planTrialNotifications()).toBe(0);
  expect(mocks.rpc).not.toHaveBeenCalled();
  await expect(composeTrialMail(job)).rejects.toThrow("nicht freigegeben");
});

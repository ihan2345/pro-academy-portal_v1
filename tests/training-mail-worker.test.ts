import { beforeEach, afterEach, it, expect, vi } from "vitest";
const mocks = vi.hoisted(() => ({ rpc: vi.fn(), from: vi.fn() }));
vi.mock("../src/lib/server/service-db", () => ({ serviceDb: () => mocks }));
import { processMail } from "../workers/jobs";
import {
  composeTrainingNotice,
  planTrainingReminders,
  prepareTrainingNotification,
} from "../workers/training-notifications";
const job = {
  id: "test-job",
  lease_token: "test-lease",
  kind: "planning",
  recipient: "parent@test.invalid",
  payload: {
    training_notice: true,
    event_id: "event",
    player_id: "child",
    notice_details: {
      title: "Training",
      starts_at: "2026-10-10T12:00:00Z",
      ends_at: "2026-10-10T13:00:00Z",
      location_name: "Sportplatz",
      address: "Weg 1",
      trainer_name: "Coach",
    },
  },
};
beforeEach(() => {
  vi.resetAllMocks();
  vi.stubEnv("STRIPE_SYNC_ONLY", "false");
  vi.stubEnv("MAIL_PROVIDER", "capture");
  vi.stubEnv("APP_URL", "https://portal.example.org");
  mocks.from.mockReturnValue({
    select: () => ({
      eq: () => ({
        single: async () => ({ data: { first_name: "Kind" }, error: null }),
      }),
    }),
  });
});
afterEach(() => vi.unstubAllEnvs());
it.each([
  ["planning", "Trainingsplanung:"],
  ["change", "Trainingsplanung aktualisiert:"],
  ["training_removed", "Teilnahme am Training aufgehoben:"],
  ["training_reminder", "Trainingserinnerung:"],
])(
  "renders complete %s mails without requiring portal access",
  async (kind, heading) => {
    const mail = await composeTrainingNotice({ ...job, kind });
    expect(mail.subject).toContain(heading);
    expect(mail.text).toContain("Sportplatz, Weg 1");
    expect(mail.text).toContain("14:00 bis 15:00");
    expect(mail.to).toBe(job.recipient);
    expect(mail.html).toContain("Frage zum Training");
  },
);
it("does not send when the final eligibility check rejects a changed recipient or event", async () => {
  let checks = 0;
  mocks.rpc.mockImplementation(async (name: string) => ({
    error: null,
    data:
      name === "claim_notifications"
        ? [job]
        : name === "prepare_training_notification"
          ? ++checks === 1
            ? job
            : null
          : null,
  }));
  const provider = { name: "proton", send: vi.fn() };
  expect(await processMail(provider)).toBe(0);
  expect(checks).toBe(2);
  expect(provider.send).not.toHaveBeenCalled();
});
it("uses the existing provider and completion record exactly once", async () => {
  mocks.rpc.mockImplementation(async (name: string) => ({
    error: null,
    data:
      name === "claim_notifications"
        ? [job]
        : name === "prepare_training_notification"
          ? job
          : null,
  }));
  const provider = {
    name: "proton",
    send: vi.fn(async () => ({ id: "smtp-id" })),
  };
  expect(await processMail(provider)).toBe(1);
  expect(provider.send).toHaveBeenCalledTimes(1);
  expect(
    mocks.rpc.mock.calls.filter((c) => c[0] === "finish_notification"),
  ).toHaveLength(1);
});
it("quarantines an uncertain SMTP result rather than scheduling a blind retry", async () => {
  mocks.rpc.mockImplementation(async (name: string) => ({
    error: null,
    data:
      name === "claim_notifications"
        ? [job]
        : name === "prepare_training_notification"
          ? job
          : null,
  }));
  const provider = {
    name: "proton",
    send: vi.fn(async () => {
      throw Object.assign(new Error("timeout"), { code: "ETIMEDOUT" });
    }),
  };
  expect(await processMail(provider)).toBe(0);
  expect(mocks.rpc).toHaveBeenCalledWith(
    "finish_notification",
    expect.objectContaining({
      input: expect.objectContaining({ status: "uncertain" }),
    }),
  );
});
it("supports runner-first deployment, but never skips a missing guard for new notices", async () => {
  mocks.rpc.mockResolvedValue({ data: null, error: { code: "PGRST202" } });
  expect(await planTrainingReminders()).toBe(0);
  await expect(prepareTrainingNotification(job)).rejects.toEqual({
    code: "PGRST202",
  });
  expect(
    await prepareTrainingNotification({ ...job, payload: {} }),
  ).toMatchObject({ id: "test-job" });
});

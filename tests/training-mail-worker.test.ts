import { beforeEach, afterEach, it, expect, vi } from "vitest";
const mocks = vi.hoisted(() => ({ rpc: vi.fn(), from: vi.fn() }));
vi.mock("../src/lib/server/service-db", () => ({ serviceDb: () => mocks }));
import { processMail } from "../workers/jobs";
import {
  composeTrainingNotice,
  composeStaffTrainingConfirmation,
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

const staffJob = {
  ...job,
  kind: "training_staff_attendance",
  recipient: "coach@test.invalid",
  payload: {
    ...job.payload,
    staff_user_id: "staff",
    manual_staff_training_notice: true,
    notice_details: {
      ...job.payload.notice_details,
      participants: [
        { id: "one", name: "Anna <Kind>" },
        { id: "two", name: "Ben Beispiel" },
      ],
    },
  },
};
it("renders the staff summary with the same branded email template and all confirmed names", () => {
  const mail = composeStaffTrainingConfirmation(staffJob);
  expect(mail.to).toBe("coach@test.invalid");
  expect(mail.subject).toBe("Training absolviert: Training");
  expect(mail.text).toContain(
    "Bestätigte Teilnahmen (2):\nAnna <Kind>\nBen Beispiel",
  );
  expect(mail.text).toContain("14:00 bis 15:00");
  expect(mail.text).toContain("Trainingsdauer: 60 Minuten");
  expect(mail.html).toContain("/brand/logo-neon.png");
  expect(mail.html).toContain("Anna &lt;Kind&gt;");
  expect(mail.html).not.toContain("Anna <Kind>");
});
it("rechecks staff eligibility immediately before the existing SMTP provider", async () => {
  let checks = 0;
  mocks.rpc.mockImplementation(async (name: string) => ({
    error: null,
    data:
      name === "claim_notifications"
        ? [staffJob]
        : name === "prepare_staff_training_notification"
          ? ++checks === 1
            ? staffJob
            : null
          : null,
  }));
  const provider = { name: "proton", send: vi.fn() };
  expect(await processMail(provider)).toBe(0);
  expect(checks).toBe(2);
  expect(provider.send).not.toHaveBeenCalled();
});
it("sends the team summary through the existing provider once after both checks", async () => {
  mocks.rpc.mockImplementation(async (name: string) => ({
    error: null,
    data:
      name === "claim_notifications"
        ? [staffJob]
        : name === "prepare_staff_training_notification"
          ? staffJob
          : null,
  }));
  const provider = {
    name: "proton",
    send: vi.fn(async (_mail: { text: string }) => ({ id: "staff-smtp" })),
  };
  expect(await processMail(provider)).toBe(1);
  expect(provider.send).toHaveBeenCalledTimes(1);
  expect(provider.send.mock.calls[0][0].text).toContain("Ben Beispiel");
});
it("fails closed for team summaries when the new database function is unavailable", async () => {
  mocks.rpc.mockResolvedValue({ error: { code: "PGRST202" }, data: null });
  await expect(
    prepareTrainingNotification({
      ...staffJob,
      payload: { ...staffJob.payload, training_notice: false },
    }),
  ).rejects.toMatchObject({ code: "PGRST202" });
});

import { afterEach, describe, expect, it, vi } from "vitest";
import {
  acceptanceTestScope,
  runAcceptanceTest,
} from "../workers/acceptance-test";
const scope = {
  participantId: "50000000-0000-4000-8000-000000000001",
  playerId: "50000000-0000-4000-8000-000000000002",
  parentId: "50000000-0000-4000-8000-000000000003",
  recipient: "test@example.com",
};
const env = {
  ACCEPTANCE_TEST_ENABLED: "true",
  ACCEPTANCE_TEST_CONFIG: JSON.stringify(scope),
  JOBS_ENABLED: "false",
  MAIL_PROVIDER: "capture",
  EMAIL_TEST_MODE: "true",
};
afterEach(() => vi.unstubAllEnvs());
function fixture(overrides = {}) {
  for (const [key, value] of Object.entries(env)) vi.stubEnv(key, value);
  const job = {
    id: "selected-job",
    status: "pending",
    attempts: 0,
    kind: "attendance",
    recipient: scope.recipient,
    idempotency_key: `attendance:p:2:${scope.parentId}`,
    payload: { participant_id: scope.participantId, player_id: scope.playerId },
    ...overrides,
  };
  const filters: unknown[][] = [];
  const db = {
    rpc: vi.fn(async (name: string, args: any) => {
      if (name === "confirm_acceptance_attendance")
        return {
          data: { confirmed: job.status === "pending" ? 1 : 0, job_id: job.id },
        };
      if (name === "finish_notification") {
        job.status = args.input.status;
        return { data: null };
      }
      throw Error("Unexpected global RPC");
    }),
    from: vi.fn((table: string) => {
      if (table !== "notification_jobs") throw Error("Unexpected table");
      let update: any;
      const chain: any = {
        select: () =>
          update ? Promise.resolve({ data: [{ id: job.id }] }) : chain,
        eq: (...args: unknown[]) => {
          filters.push(args);
          return chain;
        },
        single: async () => ({ data: { ...job } }),
        update: (data: any) => {
          update = data;
          Object.assign(job, data);
          return chain;
        },
      };
      return chain;
    }),
  };
  const compose = vi.fn(async () => ({
    to: "global-test@example.com",
    subject: "Training absolviert",
    text: "Test",
    html: "Test",
    messageId: "unique-test-job",
  }));
  const send = vi.fn(async () => ({ id: "smtp-id" }));
  return { deps: { db: db as any, compose, send }, db, filters, job, send };
}
describe("bounded acceptance run", () => {
  it.each([
    { ACCEPTANCE_TEST_ENABLED: "false" },
    { JOBS_ENABLED: "true" },
    { STRIPE_SYNC_ONLY: "true" },
    { MAIL_PROVIDER: "proton" },
    { EMAIL_TEST_MODE: "false" },
    { ACCEPTANCE_TEST_CONFIG: "{}" },
  ])(
    "requires explicit scope with normal processing still disabled: %j",
    (change) => {
      expect(() => acceptanceTestScope({ ...env, ...change })).toThrow();
    },
  );
  it("claims only the selected notification and does not send again on a second run", async () => {
    const { deps, send, db, filters } = fixture();
    expect(await runAcceptanceTest(deps)).toMatchObject({
      confirmed: 1,
      sent: 1,
    });
    expect(await runAcceptanceTest(deps)).toMatchObject({
      confirmed: 0,
      sent: 0,
    });
    expect(send).toHaveBeenCalledOnce();
    expect(send.mock.calls[0]).toEqual([
      expect.objectContaining({ to: scope.recipient }),
    ]);
    expect(filters).toContainEqual(["id", "selected-job"]);
    expect(filters).toContainEqual(["attempts", 0]);
    expect(db.rpc).toHaveBeenCalledWith("confirm_acceptance_attendance", {
      participant: scope.participantId,
      player: scope.playerId,
      parent: scope.parentId,
      recipient: scope.recipient,
    });
  });
  it("rejects another recipient before composing or sending", async () => {
    const { deps, send } = fixture({ recipient: "another@example.com" });
    await expect(runAcceptanceTest(deps)).rejects.toThrow("Testumfangs");
    expect(deps.compose).not.toHaveBeenCalled();
    expect(send).not.toHaveBeenCalled();
  });
  it("quarantines an uncertain send and never retries it automatically", async () => {
    const { deps, send, job } = fixture();
    send.mockRejectedValueOnce(new Error("Connection lost after DATA"));
    await expect(runAcceptanceTest(deps)).rejects.toThrow("manuell geprüft");
    expect(job.status).toBe("uncertain");
    await expect(runAcceptanceTest(deps)).rejects.toThrow(
      "Wiederholung manuell",
    );
    expect(send).toHaveBeenCalledOnce();
  });
});

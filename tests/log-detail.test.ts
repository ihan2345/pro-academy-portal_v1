import { beforeEach, expect, it, vi } from "vitest";
const f = vi.hoisted(() => ({
  db: vi.fn(),
  rpc: vi.fn(),
  rows: {} as Record<string, any[]>,
}));
vi.mock("../src/lib/server/service-db", () => ({ serviceDb: f.db }));
import {
  loadLogDetail,
  redactLog,
  renderLogDetail,
} from "../src/lib/server/log-detail";
const id = "a0000000-0000-4000-8000-000000000001";
const job = {
  id,
  kind: "invitation",
  recipient: "parent@example.invalid",
  status: "held",
  attempts: 0,
  last_error: null,
  created_at: "2026-10-13T14:01:40Z",
  payload: {
    parent_id: id,
    invitation_id: id,
    url: "https://portal.proacademy-ak.com/einladung?token=private-token",
  },
};
beforeEach(() => {
  vi.clearAllMocks();
  f.rows = {
    notification_jobs: [job],
    notification_deliveries: [],
    audit_log: [],
    system_settings: [{ value: { enabled: true, recipients: [] } }],
    parents: [{ id, full_name: "Test Elternteil" }],
  };
  f.rpc.mockResolvedValue({ data: false, error: null });
  f.db.mockReturnValue({
    rpc: f.rpc,
    from: (table: string) => {
      const q: any = {};
      for (const method of ["select", "eq", "order", "limit"])
        q[method] = () => q;
      q.maybeSingle = async () => ({
        data: f.rows[table]?.[0] ?? null,
        error: null,
      });
      q.then = (resolve: any) =>
        Promise.resolve({ data: f.rows[table] ?? [], error: null }).then(
          resolve,
        );
      return q;
    },
  });
});
it.each(["parent", "staff", undefined])(
  "denies %s before database reads",
  async (role) => {
    await expect(
      loadLogDetail(role, "notification_jobs", id),
    ).rejects.toThrow();
    expect(f.db).not.toHaveBeenCalled();
  },
);
it("rejects unlisted tables and invalid IDs before reads", async () => {
  await expect(
    loadLogDetail("admin", "parent_invitations", id),
  ).rejects.toThrow();
  await expect(
    loadLogDetail("admin", "notification_jobs", "bad-id"),
  ).rejects.toThrow();
  expect(f.db).not.toHaveBeenCalled();
});
it("explains held jobs without inventing a historical cause and retains reference IDs", () => {
  const text = renderLogDetail("notification_jobs", job, {
    delivery_allowed: false,
    release: { enabled: true, recipient: false },
  });
  expect(text).toContain("Portal-Einladung");
  expect(text).toContain(id);
  expect(text).toContain("noch kein Verarbeitungsversuch");
  expect(text).toContain("Kein genauer Grund gespeichert");
  expect(text).toContain("nicht zwingend den Zustand beim Anlegen");
  expect(text).not.toContain("private-token");
});
it("loads related attempts and current authorization without triggering any send or release", async () => {
  f.rows.notification_deliveries = [
    {
      id: "delivery",
      job_id: id,
      attempt: 1,
      provider: "proton",
      status: "uncertain",
      message_id: "smtp-id",
    },
  ];
  const result = await loadLogDetail("admin", "notification_jobs", id);
  expect(result.filename).toBe(`protokoll-notification_jobs-${id}.txt`);
  expect(result.text).toContain("smtp-id");
  expect(result.text).toContain("Test Elternteil");
  expect(f.rpc).toHaveBeenCalledExactlyOnceWith("parent_delivery_allowed", {
    recipient: job.recipient,
    kind: job.kind,
    payload: job.payload,
  });
});
it("opens a delivery with its original job and distinguishes SMTP from mailbox receipt", async () => {
  f.rows.notification_jobs = [{ ...job, status: "sent", attempts: 1 }];
  f.rows.notification_deliveries = [
    { id, job_id: id, attempt: 1, status: "sent", provider: "proton" },
  ];
  const result = await loadLogDetail("admin", "notification_deliveries", id);
  expect(result.text).toContain("ZUGEHÖRIGER E-MAIL-AUFTRAG");
  expect(result.text).toContain("keinen Eingang im Postfach");
});
it("redacts nested tokens, invitation links, bearer credentials, JWTs and Stripe keys", () => {
  const result = JSON.stringify(
    redactLog({
      id,
      old_value: {
        token_hash: "hash-secret",
        payload: {
          url: "https://host/path?token=private&code=auth-code",
          authorization: "Bearer secret",
        },
      },
      error: "Bearer bearer-secret sk_live_key123",
      url: "https://user:password@host/",
      jwt: "eyJabc.defghi.signature",
    }),
  );
  for (const secret of [
    "hash-secret",
    "private",
    "auth-code",
    "bearer-secret",
    "sk_live_key123",
    "password@",
    "eyJabc",
  ])
    expect(result).not.toContain(secret);
  expect(result).toContain(id);
});
it("explains audit changes, report versions and runner results", () => {
  expect(
    renderLogDetail("audit_log", {
      id,
      action: "UPDATE",
      record_id: id,
      table_name: "parents",
      old_value: { phone: "old" },
      new_value: { phone: "new" },
    }),
  ).toContain("Alte und neue Werte");
  expect(
    renderLogDetail("report_snapshots", {
      id,
      player_id: id,
      period_id: id,
      version: 2,
    }),
  ).toContain("Version: 2");
  expect(
    renderLogDetail("job_runs", {
      id,
      status: "failed",
      error: "SMTP nicht erreichbar",
    }),
  ).toContain("SMTP nicht erreichbar");
});
it("returns not found instead of an empty detail", async () => {
  f.rows.notification_jobs = [];
  await expect(loadLogDetail("admin", "notification_jobs", id)).rejects.toThrow(
    "nicht gefunden",
  );
});

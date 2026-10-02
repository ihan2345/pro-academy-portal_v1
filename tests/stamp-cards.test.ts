import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { PDFDocument } from "pdf-lib";
import { NextRequest } from "next/server";
import { portalFixture } from "./fixtures/portal";
import { stampCardSnapshot } from "../src/lib/stamp-card";
import {
  loadStampCard,
  queueStampCard,
  sendStampCard,
  stampCardRecipients,
} from "../src/lib/server/stamp-cards";
import { renderReport } from "../src/lib/pdf";
import { deliverManualStampCard } from "../workers/manual-stamp-card";
import type { MailProvider } from "../src/lib/mail";
import { compose } from "../workers/jobs";
import { GET, POST } from "../src/app/api/[...path]/route";
const mocks = vi.hoisted(() => ({
  from: vi.fn(),
  session: vi.fn(),
  rpc: vi.fn(),
}));
vi.mock("../src/lib/server/service-db", () => ({
  serviceDb: () => ({ from: mocks.from, rpc: mocks.rpc }),
}));
vi.mock("../src/lib/server/supabase", () => ({
  sessionUser: mocks.session,
  sessionDb: vi.fn(),
  serviceDb: () => ({ from: mocks.from, rpc: mocks.rpc }),
}));
const player = portalFixture.players[0],
  period = portalFixture.periods[0];
const parent = {
  id: "parent-id",
  full_name: "Test Parent",
  contact_email: "parent@example.com",
  archived_at: null,
};
let saved: Record<string, any>[];
let linked: boolean;
let actorRole: string | null;
let participantRows: any[];
let tableErrors: Record<string, { code: string; message: string }>;
function query(table: string) {
  const filters: Record<string, unknown> = {};
  let inserted: any;
  let update: any;
  const resolve = () => {
    if (tableErrors[table]) return { data: null, error: tableErrors[table] };
    if (table === "notification_jobs") {
      if (update) {
        const row = saved.find((row) =>
          Object.entries(filters).every(([key, value]) =>
            key.startsWith("payload->>")
              ? String(row.payload[key.slice(10)]) === value
              : row[key] === value,
          ),
        );
        if (row) Object.assign(row, update);
        return { data: row ? { ...row } : null, error: null };
      }
      if (inserted) {
        const row = {
          id: "job-id",
          attempts: 0,
          status: "pending",
          ...inserted,
        };
        saved.push(row);
        return { data: row, error: null };
      }
      return {
        data:
          saved.find((row) =>
            filters.id
              ? row.id === filters.id
              : row.idempotency_key === filters.idempotency_key,
          ) ?? null,
        error: null,
      };
    }
    const data =
      table === "profiles"
        ? actorRole
          ? { role: actorRole }
          : null
        : table === "entitlement_periods"
          ? filters.id === period.id
            ? period
            : null
          : table === "players"
            ? player
            : table === "event_participants"
              ? participantRows
              : table === "parent_players"
                ? linked
                  ? [{ parents: parent }]
                  : []
                : null;
    return { data, error: null };
  };
  const chain: any = {
    select: vi.fn(() => chain),
    eq: vi.fn((key, value) => {
      filters[key] = value;
      return chain;
    }),
    is: vi.fn(() => chain),
    limit: vi.fn(() => chain),
    order: vi.fn(() => chain),
    maybeSingle: vi.fn(async () => resolve()),
    single: vi.fn(async () => resolve()),
    update: vi.fn((value) => {
      update = value;
      return chain;
    }),
    upsert: vi.fn((value) => {
      inserted = value;
      return chain;
    }),
    then: (fulfilled: any, rejected: any) =>
      Promise.resolve(resolve()).then(fulfilled, rejected),
  };
  return chain;
}
const db = { from: mocks.from, rpc: mocks.rpc } as unknown as Parameters<
  typeof loadStampCard
>[0];
beforeEach(() => {
  vi.clearAllMocks();
  saved = [];
  tableErrors = {};
  linked = true;
  actorRole = "staff";
  participantRows = portalFixture.events
    .filter((event) =>
      event.participants.some((p) => p.player_id === player.id),
    )
    .map((event) => ({
      status: event.participants[0].status,
      training_events: event,
    }));
  mocks.from.mockImplementation(query);
  mocks.rpc.mockImplementation(async (name, { input }) => {
    if (name === "finish_notification")
      Object.assign(
        saved.find((job) => job.id === input.id)!,
        { status: input.status },
      );
    return { data: null, error: null };
  });
  vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "https://example.supabase.co");
  vi.stubEnv("APP_URL", "https://portal.example.com");
});
afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

it("builds a current card without private fields and excludes neutral statuses from completion", () => {
  const events = participantRows.map((row) => ({
    ...row.training_events,
    status: row.status,
    internal_note: "SECRET",
    participants: [{ name: "Other child" }],
  }));
  const snapshot = stampCardSnapshot(
    player,
    period,
    events,
    "2026-09-10T10:00:00Z",
    "491234",
  );
  expect(snapshot.completed).toBe(3);
  expect(snapshot.minutes).toBe(270);
  expect(snapshot.events.some((e) => e.status === "planned")).toBe(true);
  expect(JSON.stringify(snapshot)).not.toContain("SECRET");
  expect(JSON.stringify(snapshot)).not.toContain("Other child");
});

it.each(["parent", "", "unknown"])(
  "rejects %s before any privileged card/contact query",
  async (role) => {
    await expect(loadStampCard(db, role, period.id)).rejects.toThrow();
    await expect(stampCardRecipients(role, player.id)).rejects.toThrow();
    await expect(
      queueStampCard(db, role, "actor", {
        period_id: period.id,
        parent_id: parent.id,
        request_id: "request",
      }),
    ).rejects.toThrow();
    expect(mocks.from).not.toHaveBeenCalled();
  },
);
it.each(["staff", "admin"])(
  "allows %s to export a running period",
  async (role) => {
    const card = await loadStampCard(db, role, period.id);
    const pdf = await PDFDocument.load(
      await renderReport(card.snapshot, "stamp_card"),
    );
    expect(pdf.getTitle()).toContain("Stempelkarte Max Beispiel");
    expect(pdf.getPageCount()).toBeGreaterThan(0);
  },
);
it("rejects missing periods and truncated data", async () => {
  await expect(loadStampCard(db, "staff", "foreign-period")).rejects.toThrow(
    "nicht gefunden",
  );
  participantRows = Array(1000).fill(participantRows[0]);
  await expect(loadStampCard(db, "staff", period.id)).rejects.toThrow(
    "Zu viele Einträge",
  );
});
it("only queues a linked parent and freezes the current data exactly once per request", async () => {
  const input = {
    period_id: period.id,
    parent_id: parent.id,
    request_id: "request",
  };
  await expect(
    queueStampCard(db, "staff", "coach", {
      ...input,
      parent_id: "foreign-parent",
    }),
  ).rejects.toThrow("nicht zugeordnet");
  expect(saved).toHaveLength(0);
  await queueStampCard(db, "staff", "coach", input);
  const frozen = JSON.stringify(saved[0].payload.snapshot);
  participantRows[0].status = "excused";
  await queueStampCard(db, "staff", "coach", input);
  expect(saved).toHaveLength(1);
  expect(saved[0].recipient).toBe(parent.contact_email);
  expect(saved[0].payload.actor_id).toBe("coach");
  expect(JSON.stringify(saved[0].payload.snapshot)).toBe(frozen);
});
it("composes a PDF attachment respecting test delivery and rechecks linkage", async () => {
  await queueStampCard(db, "staff", "coach", {
    period_id: period.id,
    parent_id: parent.id,
    request_id: "request",
  });
  vi.stubEnv("MAIL_PROVIDER", "proton");
  vi.stubEnv("EMAIL_TEST_MODE", "true");
  vi.stubEnv("EMAIL_TEST_RECIPIENT", "admin@example.com");
  const mail = await compose(saved[0]);
  expect(mail.to).toBe("admin@example.com");
  expect(mail.subject).toContain("Stempelkarte");
  expect(mail.attachments?.[0].content.subarray(0, 4).toString()).toBe("%PDF");
  linked = false;
  await expect(compose(saved[0])).rejects.toThrow("Empfängerzuordnung");
});

describe("HTTP boundaries", () => {
  it.each(["team/stamp-card", "team/stamp-card-send", "team/backfills"])(
    "blocks parents on %s",
    async (path) => {
      mocks.session.mockResolvedValue({
        role: "parent",
        user: { id: "parent" },
        db,
      });
      const response = await POST(
        new NextRequest(`https://portal.example.com/api/${path}`, {
          method: "POST",
          headers: { Origin: "https://portal.example.com" },
        }),
        { params: Promise.resolve({ path: path.split("/") }) },
      );
      expect(response.status).toBe(403);
      expect(mocks.from).not.toHaveBeenCalled();
    },
  );
  it("requires authentication for exports", async () => {
    mocks.session.mockResolvedValue(null);
    const response = await GET(
      new NextRequest("https://portal.example.com/api/team/stamp-card"),
      { params: Promise.resolve({ path: ["team", "stamp-card"] }) },
    );
    expect(response.status).toBe(401);
    expect(mocks.from).not.toHaveBeenCalled();
  });
  it("blocks cross-origin mail requests", async () => {
    const response = await POST(
      new NextRequest("https://portal.example.com/api/team/stamp-card-send", {
        method: "POST",
        headers: { Origin: "https://foreign.example.com" },
      }),
      { params: Promise.resolve({ path: ["team", "stamp-card-send"] }) },
    );
    expect(response.status).toBe(403);
    expect(mocks.session).not.toHaveBeenCalled();
  });
});

it("sends only the public backfill note, respects test routing and rechecks the recipient", async () => {
  vi.stubEnv("MAIL_PROVIDER", "proton");
  vi.stubEnv("EMAIL_TEST_MODE", "true");
  vi.stubEnv("EMAIL_TEST_RECIPIENT", "own-test@example.com");
  const job = {
    id: "backfill-job",
    kind: "training_backfill",
    recipient: parent.contact_email,
    payload: {
      parent_id: parent.id,
      player_id: player.id,
      player_name: "Max Beispiel",
      backfill_id: "bf",
      parent_note: "Training nachgeholt <script>",
      internal_note: "SECRET PRIVATE",
      duration_minutes: 90,
      period_starts_at: period.starts_at,
      period_ends_at: period.ends_at,
      occurred_on: null,
    },
  };
  const mail = await compose(job);
  expect(mail.to).toBe("own-test@example.com");
  expect(mail.subject).toContain("Eine Einheit wurde nachgetragen");
  expect(mail.text).toContain("1 Std. 30 Min.");
  expect(mail.text).toContain("Trainingsdatum nicht angegeben");
  expect(mail.html).toContain("&lt;script&gt;");
  expect(JSON.stringify(mail)).not.toContain("SECRET PRIVATE");
  linked = false;
  await expect(compose(job)).rejects.toThrow("Empfängerzuordnung");
});

it("exports and queues existing cards before the optional backfill table is installed", async () => {
  tableErrors.training_backfills = {
    code: "PGRST205",
    message:
      "Could not find the table 'public.training_backfills' in the schema cache",
  };
  const card = await loadStampCard(db, "staff", period.id);
  expect(card.backfillsAvailable).toBe(false);
  expect(card.snapshot.completed).toBe(3);
  expect(card.snapshot.minutes).toBe(270);
  expect(card.privateNotes).toEqual({});
  expect(
    await PDFDocument.load(await renderReport(card.snapshot, "stamp_card")),
  ).toBeTruthy();
  await queueStampCard(db, "staff", "coach", {
    period_id: period.id,
    parent_id: parent.id,
    request_id: "legacy-request",
  });
  expect(saved[0].payload.snapshot.completed).toBe(3);
});
it("still fails card exports when backfill permissions are broken", async () => {
  tableErrors.training_backfills = {
    code: "42501",
    message: "permission denied for table training_backfills",
  };
  await expect(loadStampCard(db, "staff", period.id)).rejects.toEqual(
    tableErrors.training_backfills,
  );
});
it.each([
  {
    code: "PGRST202",
    message: "Could not find the function public.save_training_backfill",
  },
  {
    code: "42501",
    message: "permission denied for function save_training_backfill",
  },
])(
  "returns an actionable 503 when backfills are unavailable: $code",
  async (error) => {
    mocks.session.mockResolvedValue({
      role: "staff",
      user: { id: "coach" },
      db,
    });
    mocks.rpc.mockResolvedValue({
      data: null,
      error,
    });
    const response = await POST(
      new NextRequest("https://portal.example.com/api/team/backfills", {
        method: "POST",
        headers: {
          Origin: "https://portal.example.com",
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          request_id: crypto.randomUUID(),
          period_id: crypto.randomUUID(),
          event_type: "Gruppentraining",
          duration_minutes: 60,
          parent_note: "Nachgeholt",
        }),
      }),
      { params: Promise.resolve({ path: ["team", "backfills"] }) },
    );
    expect(response.status).toBe(503);
    expect((await response.json()).error).toContain(
      "noch nicht freigeschaltet",
    );
  },
);
it("checks registry availability before Stripe synchronization", async () => {
  tableErrors.stripe_customer_registry = {
    code: "PGRST205",
    message:
      "Could not find the table 'public.stripe_customer_registry' in the schema cache",
  };
  mocks.session.mockResolvedValue({ role: "admin", user: { id: "admin" }, db });
  const response = await POST(
    new NextRequest(
      "https://portal.example.com/api/admin/stripe-customers-sync",
      {
        method: "POST",
        headers: { Origin: "https://portal.example.com" },
        body: "{}",
      },
    ),
    { params: Promise.resolve({ path: ["admin", "stripe-customers-sync"] }) },
  );
  expect(response.status).toBe(503);
  expect((await response.json()).error).toContain("noch nicht freigeschaltet");
  expect(mocks.rpc).not.toHaveBeenCalled();
});

it("carries team cancellations through the database projection and public stamp-card snapshot", async () => {
  const event = participantRows[0].training_events;
  participantRows = [
    {
      status: "cancelled",
      training_events: { ...event, id: "team-cancelled", status: "cancelled" },
    },
    {
      status: "cancelled",
      training_events: {
        ...event,
        id: "individual-cancelled",
        status: "scheduled",
      },
    },
  ];
  const { snapshot } = await loadStampCard(db, "staff", period.id);
  expect(snapshot).toMatchObject({
    completed: 1,
    minutes: 0,
    attendance_policy: "team_cancellations_free_v2",
  });
  expect(snapshot.events).toEqual(
    expect.arrayContaining([
      expect.objectContaining({ id: "team-cancelled", event_cancelled: true }),
      expect.objectContaining({
        id: "individual-cancelled",
        event_cancelled: false,
      }),
    ]),
  );
});

async function sendViaRunner(
  db: Parameters<typeof sendStampCard>[0],
  role: string,
  actor: string,
  input: Parameters<typeof sendStampCard>[3],
  provider: MailProvider,
) {
  vi.stubEnv("JOB_RUNNER_URL", "https://runner.example.com");
  vi.stubEnv("CRON_SECRET", "internal-test-secret");
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string, init: RequestInit) => {
      expect(url).toBe("https://runner.example.com/stamp-card-send");
      expect(init.headers).toMatchObject({
        Authorization: "Bearer internal-test-secret",
      });
      const scope = JSON.parse(String(init.body));
      expect(Object.keys(scope).sort()).toEqual(["actor_id", "job_id"]);
      try {
        return Response.json({
          ok: true,
          ...(await deliverManualStampCard(scope, provider)),
        });
      } catch (error) {
        return Response.json(
          { error: (error as Error).message },
          { status: (error as { status?: number }).status ?? 500 },
        );
      }
    }),
  );
  return sendStampCard(db, role, actor, input);
}

describe("direct manual stamp card delivery", () => {
  const input = {
    period_id: period.id,
    email: "external@example.com",
    request_id: "manual-request",
  };
  const provider = () => ({
    name: "proton",
    send: vi.fn(async () => ({ id: "smtp-message" })),
  });
  beforeEach(() => {
    vi.stubEnv("APP_MODE", "production");
    vi.stubEnv("EMAIL_TEST_MODE", "false");
    vi.stubEnv("JOBS_ENABLED", "false");
    vi.stubEnv("STRIPE_SYNC_ONLY", "true");
    linked = false;
  });
  it("sends a PDF without parent login or linkage while jobs are disabled, and deduplicates retries", async () => {
    const mail = provider();
    await sendViaRunner(db, "staff", "coach", input, mail);
    await sendViaRunner(db, "staff", "coach", input, mail);
    expect(mail.send).toHaveBeenCalledTimes(1);
    expect(mail.send).toHaveBeenCalledWith(
      expect.objectContaining({
        to: input.email,
        attachments: [
          expect.objectContaining({ contentType: "application/pdf" }),
        ],
      }),
    );
    expect(saved[0]).toMatchObject({
      status: "sent",
      payload: { manual_email: true, actor_id: "coach" },
    });
    expect(
      mocks.rpc.mock.calls.every(([name]) => name === "finish_notification"),
    ).toBe(true);
  });
  it("does not let simultaneous requests claim the same message twice", async () => {
    const mail = provider();
    await queueStampCard(db, "staff", "coach", input, true);
    await Promise.allSettled([
      sendViaRunner(db, "staff", "coach", input, mail),
      sendViaRunner(db, "staff", "coach", input, mail),
    ]);
    expect(mail.send).toHaveBeenCalledTimes(1);
  });
  it("quarantines ambiguous SMTP failures and refuses automatic resend", async () => {
    const mail = provider();
    mail.send.mockRejectedValue(new Error("Connection lost"));
    await expect(
      sendViaRunner(db, "admin", "coach", input, mail),
    ).rejects.toThrow("Versandprotokoll");
    expect(saved[0].status).toBe("uncertain");
    await expect(
      sendViaRunner(db, "admin", "coach", input, mail),
    ).rejects.toThrow("Versandprotokoll");
    expect(mail.send).toHaveBeenCalledTimes(1);
  });
  it("keeps test routing and increments attempts for safe configuration retries", async () => {
    const mail = provider();
    vi.stubEnv("EMAIL_TEST_MODE", "true");
    vi.stubEnv("EMAIL_TEST_RECIPIENT", "");
    await expect(
      sendViaRunner(db, "staff", "coach", input, mail),
    ).rejects.toThrow("Versandprotokoll");
    expect(saved[0].status).toBe("held");
    vi.stubEnv("EMAIL_TEST_RECIPIENT", "test@example.com");
    await sendViaRunner(db, "staff", "coach", input, mail);
    expect(mail.send).toHaveBeenCalledWith(
      expect.objectContaining({ to: "test@example.com" }),
    );
    expect(saved[0].attempts).toBe(2);
  });
  it("rejects recipient changes for an existing request", async () => {
    const mail = provider();
    await sendViaRunner(db, "staff", "coach", input, mail);
    await expect(
      sendViaRunner(
        db,
        "staff",
        "coach",
        { ...input, email: "other@example.com" },
        mail,
      ),
    ).rejects.toThrow("anderen Stempelkarte");
    expect(mail.send).toHaveBeenCalledTimes(1);
  });
  it("keeps parent authorization and the local side-effect block", async () => {
    const mail = provider();
    await expect(
      sendViaRunner(db, "parent", "coach", input, mail),
    ).rejects.toThrow();
    vi.stubEnv("CAMP_SIDE_EFFECTS_BLOCKED", "true");
    await expect(
      sendViaRunner(db, "staff", "coach", input, mail),
    ).rejects.toThrow("gesperrt");
    expect(mail.send).not.toHaveBeenCalled();
    expect(mocks.from).not.toHaveBeenCalled();
  });
});

it("rejects nonmanual jobs, foreign actors and revoked staff access before sending", async () => {
  const provider = { name: "capture", send: vi.fn() };
  await queueStampCard(
    db,
    "staff",
    "coach",
    { period_id: period.id, email: "direct@example.com", request_id: "scope" },
    true,
  );
  await expect(
    deliverManualStampCard({ job_id: "job-id", actor_id: "foreign" }, provider),
  ).rejects.toThrow("Berechtigung");
  saved[0].kind = "invitation";
  await expect(
    deliverManualStampCard({ job_id: "job-id", actor_id: "coach" }, provider),
  ).rejects.toThrow("Berechtigung");
  saved[0].kind = "stamp_card";
  actorRole = "parent";
  await expect(
    deliverManualStampCard({ job_id: "job-id", actor_id: "coach" }, provider),
  ).rejects.toThrow("Berechtigung");
  expect(provider.send).not.toHaveBeenCalled();
  expect(saved[0].status).toBe("held");
});

it("allows safe retry after a TLS connection failure but never retries accepted SMTP mail", async () => {
  vi.stubEnv("APP_MODE", "production");
  vi.stubEnv("EMAIL_TEST_MODE", "false");
  const provider = {
    name: "proton",
    send: vi
      .fn()
      .mockRejectedValueOnce(
        Object.assign(new Error("TLS Handshake Failed."), {
          code: "ESOCKET",
          command: "CONN",
        }),
      )
      .mockResolvedValue({ id: "sent" }),
  };
  const input = {
    period_id: period.id,
    email: "direct@example.com",
    request_id: "tls",
  };
  await expect(
    sendViaRunner(db, "staff", "coach", input, provider),
  ).rejects.toThrow();
  expect(saved[0].status).toBe("held");
  await sendViaRunner(db, "staff", "coach", input, provider);
  await sendViaRunner(db, "staff", "coach", input, provider);
  expect(saved[0]).toMatchObject({ status: "sent", attempts: 2 });
  expect(provider.send).toHaveBeenCalledTimes(2);
});

it("keeps the queued request untouched if the runner cannot be reached", async () => {
  vi.stubEnv("JOB_RUNNER_URL", "https://runner.example.com");
  vi.stubEnv("CRON_SECRET", "internal-test-secret");
  vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("timeout")));
  await expect(
    sendStampCard(db, "staff", "coach", {
      period_id: period.id,
      email: "direct@example.com",
      request_id: "timeout",
    }),
  ).rejects.toThrow("Antwort ausgeblieben");
  expect(saved[0]).toMatchObject({ status: "held", attempts: 0 });
  expect(mocks.rpc).not.toHaveBeenCalled();
});

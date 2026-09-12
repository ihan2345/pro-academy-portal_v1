import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { PDFDocument } from "pdf-lib";
import { NextRequest } from "next/server";
import { portalFixture } from "./fixtures/portal";
import { stampCardSnapshot } from "../src/lib/stamp-card";
import {
  loadStampCard,
  queueStampCard,
  stampCardRecipients,
} from "../src/lib/server/stamp-cards";
import { renderReport } from "../src/lib/pdf";
import { compose } from "../workers/jobs";
import { GET, POST } from "../src/app/api/[...path]/route";
const mocks = vi.hoisted(() => ({ from: vi.fn(), session: vi.fn() }));
vi.mock("../src/lib/server/service-db", () => ({
  serviceDb: () => ({ from: mocks.from }),
}));
vi.mock("../src/lib/server/supabase", () => ({
  sessionUser: mocks.session,
  sessionDb: vi.fn(),
  serviceDb: () => ({ from: mocks.from }),
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
let participantRows: any[];
function query(table: string) {
  const filters: Record<string, unknown> = {};
  let inserted: any;
  const resolve = () => {
    if (table === "notification_jobs") {
      if (inserted) {
        const row = { id: "job-id", ...inserted };
        saved.push(row);
        return { data: row, error: null };
      }
      return {
        data:
          saved.find(
            (row) => row.idempotency_key === filters.idempotency_key,
          ) ?? null,
        error: null,
      };
    }
    const data =
      table === "entitlement_periods"
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
    maybeSingle: vi.fn(async () => resolve()),
    single: vi.fn(async () => resolve()),
    upsert: vi.fn((value) => {
      inserted = value;
      return chain;
    }),
    then: (fulfilled: any, rejected: any) =>
      Promise.resolve(resolve()).then(fulfilled, rejected),
  };
  return chain;
}
const db = { from: mocks.from } as unknown as Parameters<
  typeof loadStampCard
>[0];
beforeEach(() => {
  vi.clearAllMocks();
  saved = [];
  linked = true;
  participantRows = portalFixture.events
    .filter((event) =>
      event.participants.some((p) => p.player_id === player.id),
    )
    .map((event) => ({
      status: event.participants[0].status,
      training_events: event,
    }));
  mocks.from.mockImplementation(query);
  vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "https://example.supabase.co");
  vi.stubEnv("APP_URL", "https://portal.example.com");
});
afterEach(() => vi.unstubAllEnvs());

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
  it.each(["team/stamp-card", "team/stamp-card-send"])(
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

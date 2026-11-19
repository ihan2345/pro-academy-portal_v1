import { describe, expect, it } from "vitest";
import { buildTrialBellEvents, type TrialBellInput } from "@/lib/trials/bell";
import { trialNotes } from "@/design-2026/notifications";

const now = Date.parse("2026-11-19T18:00:00Z");
const ago = (h: number) => new Date(now - h * 3600000).toISOString();
const id = (n: number) =>
  `c0000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const row = (
  n: number,
  extra: Partial<TrialBellInput["rows"][number]> = {},
) => ({
  id: id(n),
  family_id: id(100 + n),
  first_name: `Kind${n}`,
  last_name: "Muster",
  parent_name: `Eltern ${n}`,
  status: "planned",
  created_at: ago(24 * 60),
  ...extra,
});
const empty: TrialBellInput = {
  rows: [],
  feedback: [],
  mails: [],
  audits: [],
  families: [],
};

describe("Probetraining in der Glocke", () => {
  it("leitet alle Schritte von der Anfrage bis zur Abo-Übernahme ab", () => {
    const events = buildTrialBellEvents(
      {
        ...empty,
        rows: [
          row(1, { status: "new", created_at: ago(1) }),
          row(2, {
            scheduled_at: ago(5),
            starts_at: ago(-48),
            event_title: "U10 Dienstag",
          }),
          // Rückwirkend: Termin lag vor dem Eintragen, Teilnahme im selben Schritt.
          row(3, {
            scheduled_at: ago(3),
            confirmed_at: ago(3),
            starts_at: ago(72),
            attendance: "attended_manual",
            feedback_at: ago(2),
          }),
          row(4, { converted_at: ago(6), converted_player_id: id(44) }),
          row(5, { created_at: ago(24 * 40) }),
        ],
        feedback: [
          {
            request_id: id(3),
            rating: 2,
            feedback: "Zu voll",
            created_at: ago(1),
            comment_submitted_at: ago(1),
          },
          {
            request_id: id(5),
            rating: 5,
            feedback: "",
            created_at: ago(30),
            comment_submitted_at: null,
          },
          {
            request_id: id(5),
            rating: 5,
            feedback: "Super",
            created_at: ago(24 * 50),
            comment_submitted_at: ago(4),
          },
        ],
        mails: [
          {
            id: id(60),
            kind: "trial_feedback",
            status: "sent",
            updated_at: ago(2),
            payload: { request_id: id(3) },
          },
          {
            id: id(61),
            kind: "trial_day7",
            status: "sent",
            updated_at: ago(8),
            payload: { family_id: id(105) },
          },
          {
            id: id(62),
            kind: "trial_day14",
            status: "failed",
            updated_at: ago(8),
            payload: { family_id: id(105) },
          },
        ],
        audits: [
          {
            id: id(70),
            table_name: "event_participants",
            record_id: id(71),
            created_at: ago(9),
            old_value: { status: "planned" },
            new_value: { status: "absent", trial_request_id: id(2) },
          },
          {
            id: id(72),
            table_name: "trial_requests",
            record_id: id(2),
            created_at: ago(7),
            old_value: { status: "planned" },
            new_value: { status: "closed" },
          },
        ],
        families: [
          {
            id: id(105),
            parent_name: "Eltern 5",
            marketing_stopped_at: ago(1),
          },
        ],
      },
      now,
    );
    const kinds = events.map((e) => e.kind).sort();
    expect(kinds).toEqual(
      [
        "absent",
        "closed",
        "comment",
        "converted",
        "day7",
        "feedback",
        "followup_failed",
        "mail_sent",
        "past",
        "planned",
        "rating",
        "rating",
        "request",
        "unsubscribed",
      ].sort(),
    );
    // Rückwirkend eingetragen erzeugt keine doppelte Teilnahme-Meldung.
    expect(events.some((e) => e.kind === "attended")).toBe(false);
    expect(events.find((e) => e.kind === "request")?.open).toBe(true);
    expect(
      events.find((e) => e.kind === "rating" && e.rating === 2)?.open,
    ).toBe(true);
    expect(events.find((e) => e.kind === "day7")?.child).toBe("Kind5 Muster");
  });

  it("zeigt schlechte Bewertungen und offene Anfragen unter Jetzt wichtig, den Rest als Neu", () => {
    const events = buildTrialBellEvents(
      {
        ...empty,
        rows: [
          row(1, { status: "new", created_at: ago(24 * 10) }),
          row(2, { status: "contacted", created_at: ago(24 * 10) }),
          row(3, { converted_at: ago(2), converted_player_id: id(33) }),
        ],
        feedback: [
          {
            request_id: id(2),
            rating: 1,
            feedback: "",
            created_at: ago(3),
            comment_submitted_at: null,
          },
        ],
      },
      now,
    );
    const notes = trialNotes(events, "/admin", now);
    const now_ = notes.filter((n) => n.group === "now").map((n) => n.title);
    expect(now_).toContain("Neue Probetraining-Anfrage · Kind1 Muster");
    expect(now_).toContain("Schlechte Elternbewertung 1/5 · Kind2 Muster");
    // Nicht mehr offene Anfrage älter als 7 Tage verschwindet aus Neu.
    expect(
      notes.some(
        (n) => n.title.includes("Kind2") && n.title.startsWith("Neue"),
      ),
    ).toBe(false);
    const abo = notes.find((n) => n.title.startsWith("Abo übernommen"));
    expect(abo?.group).toBe("news");
    expect(abo?.href).toBe(`/admin/spieler/${id(33)}`);
    expect(notes.find((n) => n.title.startsWith("Neue"))?.href).toBe(
      `/admin/probetraining?request=${id(1)}`,
    );
  });
});

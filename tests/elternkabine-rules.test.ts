import { describe, expect, it } from "vitest";
import {
  bodyProblem,
  coChangesLeft,
  graceDaysLeft,
  inviteWaitHours,
  postAllowed,
} from "../src/lib/elternkabine/rules";

describe("Elternkabine-Regeln", () => {
  it("lässt Probetraining-Eltern nur Fragen stellen, Antworten kommen vom Team", () => {
    const ask = { level: "ask" as const };
    expect(
      postAllowed({
        access: ask,
        kind: "question",
        isReply: false,
        channelKind: "trial",
      }),
    ).toBeNull();
    expect(
      postAllowed({
        access: ask,
        kind: "tip",
        isReply: false,
        channelKind: "trial",
      }),
    ).toMatch(/nur Fragen/);
    expect(
      postAllowed({
        access: ask,
        kind: "text",
        isReply: true,
        channelKind: "trial",
      }),
    ).toMatch(/Team/);
    expect(
      postAllowed({
        access: ask,
        kind: "text",
        isReply: true,
        channelKind: "ask_team",
        ownThread: true,
      }),
    ).toBeNull();
  });
  it("sperrt Schreiben in der Lesefrist und ohne Region", () => {
    expect(
      postAllowed({
        access: { level: "read", grace_until: "2026-12-01" },
        kind: "text",
        isReply: false,
        channelKind: "general",
      }),
    ).toMatch(/mitlesen/);
    expect(
      postAllowed({
        access: { level: "locked", reason: "region" },
        kind: "text",
        isReply: false,
        channelKind: "region",
      }),
    ).toMatch(/Region/);
    expect(
      postAllowed({
        access: { level: "write" },
        kind: "info",
        isReply: false,
        channelKind: "general",
      }),
    ).toMatch(/Team/);
    expect(
      postAllowed({
        access: { level: "write", team: true },
        kind: "info",
        isReply: false,
        channelKind: "general",
      }),
    ).toBeNull();
  });
  it("filtert Links, Telefonnummern und Beleidigungen", () => {
    expect(bodyProblem("Schaut mal www.beispiel.de")).toMatch(/Links/);
    expect(bodyProblem("Ruf an: 0176 1234 5678")).toMatch(/Telefonnummern/);
    expect(bodyProblem("Hat jemand Hallenschuhe in 33?")).toBeNull();
    expect(bodyProblem("U9 um 17:30 Uhr")).toBeNull();
  });
  it("begrenzt Zweitkonto-Wechsel und Einladungen", () => {
    const now = new Date("2026-11-19T10:00:00Z");
    expect(coChangesLeft(["2026-11-02T00:00:00Z"], now)).toBe(1);
    expect(
      coChangesLeft(["2026-11-02T00:00:00Z", "2026-11-10T00:00:00Z"], now),
    ).toBe(0);
    expect(
      coChangesLeft(["2026-10-30T00:00:00Z", "2026-10-31T00:00:00Z"], now),
    ).toBe(2);
    expect(inviteWaitHours("2026-11-19T09:00:00Z", now.getTime())).toBe(23);
    expect(inviteWaitHours("2026-11-18T09:00:00Z", now.getTime())).toBe(0);
    expect(graceDaysLeft("2026-11-25T10:00:00Z", now.getTime())).toBe(6);
  });
});

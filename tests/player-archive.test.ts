import { describe, expect, it } from "vitest";
import { archiveStatus } from "../src/lib/player-archive";

describe("Archiv Alle Spieler: Status", () => {
  const base = {
    activeSubscription: false,
    hadSubscription: false,
    camps: 0,
    trial: false,
  };
  it("aktives Abo hat Vorrang", () => {
    expect(
      archiveStatus({
        ...base,
        activeSubscription: true,
        hadSubscription: true,
        camps: 2,
        trial: true,
      }),
    ).toBe("abo");
  });
  it("nur Camp ohne jemals ein Abo", () => {
    expect(archiveStatus({ ...base, camps: 1, trial: true })).toBe("camp");
  });
  it("Probetraining ohne Abo und ohne Camp", () => {
    expect(archiveStatus({ ...base, trial: true })).toBe("trial");
  });
  it("früheres Abo ist inaktiv, auch mit Camp", () => {
    expect(archiveStatus({ ...base, hadSubscription: true, camps: 3 })).toBe(
      "inactive",
    );
  });
  it("ohne jeden Status inaktiv", () => {
    expect(archiveStatus(base)).toBe("inactive");
  });
});

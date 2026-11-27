import { describe, expect, it } from "vitest";
import {
  clearCached,
  loadCached,
  peekCached,
  prefetchCached,
  setCached,
} from "@/design-2026/swr";

const later = <T>(value: T, ms = 5) =>
  new Promise<T>((r) => setTimeout(() => r(value), ms));

describe("Zwischenspeicher (stale-while-revalidate)", () => {
  it("teilt eine laufende Ladung und merkt das Ergebnis", async () => {
    clearCached();
    let calls = 0;
    const loader = () => {
      calls++;
      return later(7);
    };
    const [a, b] = await Promise.all([
      loadCached("t:a", loader),
      loadCached("t:a", loader),
    ]);
    expect([a, b, calls]).toEqual([7, 7, 1]);
    expect(peekCached<number>("t:a").data).toBe(7);
  });

  it("force lädt neu, eine ältere Antwort überschreibt nicht", async () => {
    clearCached();
    const slow = loadCached("t:b", () => later("alt", 30));
    const fresh = loadCached("t:b", () => later("neu", 5), { force: true });
    await Promise.all([slow, fresh]);
    expect(peekCached<string>("t:b").data).toBe("neu");
  });

  it("behält den alten Stand, wenn das Nachladen scheitert", async () => {
    clearCached();
    setCached("t:c", 3);
    await expect(
      loadCached("t:c", () => Promise.reject(new Error("weg"))),
    ).rejects.toThrow("weg");
    expect(peekCached<number>("t:c").data).toBe(3);
  });

  it("lädt frische Werte nicht doppelt vor", async () => {
    clearCached();
    setCached("t:d", 1);
    let calls = 0;
    prefetchCached("t:d", async () => ++calls, 60000);
    await later(null);
    expect(calls).toBe(0);
    prefetchCached("t:e", async () => ++calls, 60000);
    await later(null);
    expect([calls, peekCached<number>("t:e").data]).toEqual([1, 1]);
  });
});

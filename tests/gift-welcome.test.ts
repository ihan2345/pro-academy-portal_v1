import { it, expect } from "vitest";
import { claimGiftWelcome } from "../src/lib/gifts/welcome";
it("opens only once for a positive balance in a login session, including after a refresh or token renewal", () => {
  const values = new Map<string, string>(),
    storage = {
      getItem: (k: string) => values.get(k) ?? null,
      setItem: (k: string, v: string) => values.set(k, v),
    };
  const state = {
    has_cards: true,
    available: 3000,
    welcome_key: "session-test-1",
  };
  expect(claimGiftWelcome(state, storage)).toBe(true);
  expect(claimGiftWelcome({ ...state, available: 8000 }, storage)).toBe(false);
  expect(values.size).toBe(1);
  expect(
    claimGiftWelcome({ ...state, welcome_key: "session-test-2" }, storage),
  ).toBe(true);
});
it("never consumes the welcome marker for an empty, spent or unavailable balance", () => {
  const storage = {
    getItem: () => null,
    setItem: () => {
      throw Error("must not write");
    },
  };
  expect(
    claimGiftWelcome(
      { has_cards: false, available: 0, welcome_key: "empty-test" },
      storage,
    ),
  ).toBe(false);
  expect(
    claimGiftWelcome(
      { has_cards: true, available: 0, welcome_key: "empty-test" },
      storage,
    ),
  ).toBe(false);
  expect(
    claimGiftWelcome(
      { has_cards: true, available: 3000, welcome_key: "empty-test" },
      null,
    ),
  ).toBe(true);
});
it("respects an existing session marker after a full page reload", () => {
  expect(
    claimGiftWelcome(
      { has_cards: true, available: 3000, welcome_key: "reloaded-session" },
      {
        getItem: () => "1",
        setItem: () => {
          throw Error("must not write again");
        },
      },
    ),
  ).toBe(false);
});

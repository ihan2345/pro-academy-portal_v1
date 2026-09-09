import { afterEach, describe, expect, it, vi } from "vitest";
import { canonicalLocalLogin } from "../src/lib/server/local-login";
import { requireOrigin } from "../src/lib/server/security";
afterEach(() => vi.unstubAllEnvs());
function setup() {
  vi.stubEnv("NODE_ENV", "development");
  vi.stubEnv("APP_URL", "http://127.0.0.1:3000");
}
describe("local login host", () => {
  it("redirects the alternate local address to the configured login", () => {
    setup();
    expect(canonicalLocalLogin("localhost:3000")).toBe(
      "http://127.0.0.1:3000/login",
    );
  });
  it.each([
    "127.0.0.1:3000",
    "localhost:3001",
    "localhost.attacker.example:3000",
    null,
  ])("does not redirect canonical, foreign or missing hosts: %s", (host) => {
    setup();
    expect(canonicalLocalLogin(host)).toBeNull();
  });
  it("never enables local redirects for production", () => {
    setup();
    vi.stubEnv("NODE_ENV", "production");
    expect(canonicalLocalLogin("localhost:3000")).toBeNull();
  });
  it("preserves the exact origin check for API writes", () => {
    setup();
    expect(() =>
      requireOrigin(
        new Request("http://127.0.0.1:3000/api/auth/login", {
          method: "POST",
          headers: { origin: "http://localhost:3000" },
        }),
      ),
    ).toThrow("Anfrage nicht erlaubt.");
  });
});

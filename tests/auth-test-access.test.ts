import { afterEach, describe, expect, it, vi } from "vitest";
import { isAllowedTestLogin } from "../src/lib/server/auth-test-access";
import { safeRecipient } from "../src/lib/mail";

afterEach(() => vi.unstubAllEnvs());
describe("separate login and notification test restrictions", () => {
  it("allows only exact configured accounts, including the original admin", () => {
    vi.stubEnv("EMAIL_TEST_MODE", "true");
    vi.stubEnv("EMAIL_TEST_RECIPIENT", "admin@example.com");
    vi.stubEnv("AUTH_TEST_EMAILS", " Parent@Example.com, other@example.com ");
    expect(isAllowedTestLogin("admin@example.com")).toBe(true);
    expect(isAllowedTestLogin("parent@example.com")).toBe(true);
    expect(isAllowedTestLogin("other@example.com")).toBe(true);
    expect(isAllowedTestLogin("foreign@example.com")).toBe(false);
    expect(isAllowedTestLogin("parent@example.com.attacker.test")).toBe(false);
  });
  it("keeps all notification delivery confined to the admin recipient", () => {
    vi.stubEnv("APP_MODE", "test");
    vi.stubEnv("EMAIL_TEST_MODE", "true");
    vi.stubEnv("EMAIL_TEST_RECIPIENT", "admin@example.com");
    vi.stubEnv("AUTH_TEST_EMAILS", "parent@example.com");
    expect(isAllowedTestLogin("parent@example.com")).toBe(true);
    expect(safeRecipient("parent@example.com")).toBe("admin@example.com");
  });
  it("fails closed without configured recipients", () => {
    vi.stubEnv("EMAIL_TEST_MODE", "true");
    vi.stubEnv("EMAIL_TEST_RECIPIENT", "");
    vi.stubEnv("AUTH_TEST_EMAILS", " , ");
    expect(isAllowedTestLogin("parent@example.com")).toBe(false);
    expect(isAllowedTestLogin("")).toBe(false);
  });
  it("removes only the test login restriction when normal operation is enabled", () => {
    vi.stubEnv("EMAIL_TEST_MODE", "false");
    expect(isAllowedTestLogin("parent@example.com")).toBe(true);
  });
});

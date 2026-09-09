import { describe, it, expect, vi, afterEach } from "vitest";
import Stripe from "stripe";
import {
  assertRole,
  parentCancellation,
  checkSecret,
  hashToken,
  requireOrigin,
} from "../src/lib/server/security";
import { safeRecipient, CaptureProvider, htmlEmail } from "../src/lib/mail";
import { verifyStripe } from "../src/lib/server/stripe";
import { trainingSchema } from "../src/lib/server/schemas";
afterEach(() => vi.unstubAllEnvs());
describe("API security boundaries", () => {
  it("rejects parent/staff admin access", () => {
    expect(() => assertRole("parent", "team")).toThrow();
    expect(() => assertRole("staff", "admin")).toThrow();
    expect(() => assertRole("admin", "admin")).not.toThrow();
  });
  it.each(["false", "true"])(
    "never exposes unimplemented cancellation even with flag %s",
    (flag) => {
      vi.stubEnv("PARENT_CANCELLATION_ENABLED", flag);
      expect(() => parentCancellation()).toThrow("MVP");
    },
  );
  it("requires strong exact cron secret", () => {
    expect(checkSecret("short", "short")).toBe(false);
    expect(checkSecret("x".repeat(32), "x".repeat(32))).toBe(true);
    expect(checkSecret("y".repeat(32), "x".repeat(32))).toBe(false);
  });
  it("rejects cross-site requests", () => {
    vi.stubEnv("APP_URL", "https://portal.example.com");
    expect(() =>
      requireOrigin(
        new Request("https://portal.example.com/api/team", {
          method: "POST",
          headers: { Origin: "https://evil.example" },
        }),
      ),
    ).toThrow();
  });
  it("stores only token hashes", () =>
    expect(hashToken("token")).not.toBe("token"));
  it("verifies genuine Stripe signatures and rejects manipulated payloads", async () => {
    vi.stubEnv("STRIPE_SECRET_KEY", "sk_test_fake");
    vi.stubEnv("STRIPE_WEBHOOK_SECRET", "whsec_test");
    vi.stubEnv("APP_MODE", "test");
    const payload = JSON.stringify({
      id: "evt_test",
      type: "customer.updated",
      data: { object: { id: "cus_test" } },
    });
    const signature = Stripe.webhooks.generateTestHeaderString({
      payload,
      secret: "whsec_test",
    });
    expect((await verifyStripe(payload, signature)).id).toBe("evt_test");
    await expect(
      verifyStripe(payload.replace("cus_test", "cus_hacked"), signature),
    ).rejects.toThrow();
  });
  it("rejects live Stripe keys in test mode", async () => {
    vi.stubEnv("STRIPE_SECRET_KEY", "sk_live_never");
    vi.stubEnv("APP_MODE", "test");
    await expect(verifyStripe("{}", "fake")).rejects.toThrow("Testschlüssel");
  });
  it("blocks real recipients and escapes template input", async () => {
    vi.stubEnv("APP_MODE", "test");
    vi.stubEnv("EMAIL_TEST_MODE", "true");
    vi.stubEnv("EMAIL_TEST_RECIPIENT", "test@example.com");
    expect(safeRecipient("real-parent@example.com")).toBe("test@example.com");
    vi.stubEnv("EMAIL_TEST_MODE", "false");
    expect(() => safeRecipient("real@example.com")).toThrow();
    expect(
      htmlEmail("<script>", "<b>unsafe</b>", "https://example.com"),
    ).toContain("&lt;script&gt;");
  });
  it("capture provider performs no network delivery", async () => {
    const provider = new CaptureProvider();
    await provider.send({
      to: "example@test.invalid",
      subject: "Test",
      text: "Test",
      html: "Test",
      messageId: "unique",
    });
    expect(provider.sent).toHaveLength(1);
  });
});

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import Stripe from "stripe";
const state = vi.hoisted(() => ({ enqueue: vi.fn() }));
vi.mock("../src/lib/camps/processing", () => ({
  campReadStripe: () => new Stripe("sk_live_testonly"),
  enqueueCampEvent: state.enqueue,
}));
import { POST } from "../src/app/api/camp/webhook/route";
import {
  campProcessingEnabled,
  campReviewEnabled,
} from "../src/lib/camps/processing-config";
const secret = "whsec_test_only_local";
const stripe = new Stripe("sk_live_testonly");
const payload = JSON.stringify({
  id: "evt_test",
  type: "checkout.session.completed",
  livemode: true,
  data: { object: { id: "cs_live_test" } },
});
function request(
  body = payload,
  signature = stripe.webhooks.generateTestHeaderString({
    payload: body,
    secret,
  }),
) {
  return new Request("https://camp.example.invalid/api/camp/webhook", {
    method: "POST",
    headers: { host: "camp.example.invalid", "stripe-signature": signature },
    body,
  });
}
beforeEach(() => {
  vi.stubEnv("NODE_ENV", "production");
  vi.stubEnv("CAMP_LOCAL_ENABLED", "false");
  vi.stubEnv("CAMP_DEPLOYMENT_ENABLED", "true");
  vi.stubEnv("CAMP_PUBLIC_ORIGIN", "https://camp.example.invalid");
  vi.stubEnv("CAMP_REVIEW_ENABLED", "true");
  vi.stubEnv("CAMP_PROCESSING_ENABLED", "true");
  vi.stubEnv("CAMP_SIDE_EFFECTS_BLOCKED", "false");
  vi.stubEnv("CAMP_STRIPE_WEBHOOK_SECRET", secret);
  state.enqueue.mockReset().mockResolvedValue({ received: true });
});
afterEach(() => vi.unstubAllEnvs());
describe("isolated Camp webhook", () => {
  it("requires separate release flags, never enables processing in local development", async () => {
    vi.stubEnv("CAMP_PROCESSING_ENABLED", "false");
    expect((await POST(request())).status).toBe(404);
    expect(campReviewEnabled()).toBe(true);
    vi.stubEnv("CAMP_PROCESSING_ENABLED", "true");
    vi.stubEnv("NODE_ENV", "development");
    vi.stubEnv("CAMP_LOCAL_ENABLED", "true");
    vi.stubEnv("CAMP_SIDE_EFFECTS_BLOCKED", "true");
    expect(campProcessingEnabled()).toBe(false);
    expect((await POST(request())).status).toBe(404);
    expect(state.enqueue).not.toHaveBeenCalled();
  });
  it("rejects tampering, absent signatures and wrong hosts before persistence", async () => {
    expect((await POST(request(payload, "invalid"))).status).toBe(400);
    const signed = stripe.webhooks.generateTestHeaderString({
      payload,
      secret,
    });
    expect((await POST(request(payload + " ", signed))).status).toBe(400);
    const foreign = request();
    foreign.headers.set("host", "wrong.invalid");
    expect((await POST(foreign)).status).toBe(404);
    expect(state.enqueue).not.toHaveBeenCalled();
  });
  it("accepts a valid signature only after durable enqueue; retries on a storage failure", async () => {
    expect((await POST(request())).status).toBe(200);
    expect(state.enqueue).toHaveBeenCalledWith(
      expect.objectContaining({ id: "evt_test" }),
    );
    state.enqueue.mockRejectedValue(new Error("database offline"));
    expect((await POST(request())).status).toBe(503);
  });
  it("bounds streaming payloads even without Content-Length", async () => {
    expect((await POST(request("x".repeat(262145), "invalid"))).status).toBe(
      413,
    );
    expect(state.enqueue).not.toHaveBeenCalled();
  });
});

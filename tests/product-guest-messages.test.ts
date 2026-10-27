import { beforeEach, afterEach, expect, it, vi } from "vitest";
const state = vi.hoisted(() => ({
  order: {} as any,
  jobs: [] as any[],
  patches: [] as any[],
  generate: vi.fn(),
  rpc: vi.fn(),
}));
vi.mock("../src/lib/server/products/context", () => ({
  checked: (r: any) => {
    if (r.error) throw r.error;
    return r.data;
  },
}));
vi.mock("../src/lib/server/service-db", () => ({
  serviceDb: () => ({
    rpc: state.rpc,
    auth: { admin: { generateLink: state.generate } },
    from: (table: string) => {
      let patch: any;
      const b: any = {
        select: () => b,
        eq: () => b,
        single: async () => ({ data: state.order }),
        update: (p: any) => {
          patch = p;
          return b;
        },
        then: (resolve: any) => {
          if (patch) state.patches.push({ table, patch });
          return Promise.resolve({ data: [] }).then(resolve);
        },
      };
      return b;
    },
  }),
}));
import { processGuestMessages } from "../src/lib/server/products/guest-messages";
const provider = {
  name: "test-capture",
  send: vi.fn(async (_mail: any) => ({ id: "test" })),
};
beforeEach(() => {
  vi.clearAllMocks();
  state.patches = [];
  vi.stubEnv("PRODUCT_GUEST_MAIL_ENABLED", "true");
  vi.stubEnv("APP_MODE", "test");
  vi.stubEnv("APP_URL", "http://127.0.0.1:3110");
  vi.stubEnv("EMAIL_TEST_MODE", "true");
  vi.stubEnv("EMAIL_TEST_RECIPIENT", "capture@example.invalid");
  state.jobs = [{ intent_id: "order", attempts: 1, lease_token: "lease" }];
  state.rpc.mockImplementation(async () => ({ data: state.jobs }));
  state.order = {
    id: "order",
    guest_data: { email: "purchaser@example.invalid" },
    proof: { payment_status: "paid" },
    status: "fulfilled",
    product: { name: "Training" },
    expected_amount: 7920,
    currency: "eur",
    subscription_id: "sub_paid",
  };
  state.generate.mockResolvedValue({
    data: {
      properties: { hashed_token: "a".repeat(64), verification_type: "invite" },
    },
    error: null,
  });
});
afterEach(() => vi.unstubAllEnvs());
it("requires the separate transactional switch and cannot release unrelated held mail", async () => {
  vi.stubEnv("PRODUCT_GUEST_MAIL_ENABLED", "false");
  expect(await processGuestMessages(provider)).toBe(0);
  expect(state.rpc).not.toHaveBeenCalled();
  expect(provider.send).not.toHaveBeenCalled();
});
it("sends the receipt and activation link only after payment, keeping the subscription active independently", async () => {
  expect(await processGuestMessages(provider)).toBe(1);
  expect(state.generate).toHaveBeenCalledWith({
    type: "invite",
    email: "capture@example.invalid",
  });
  const message = provider.send.mock.calls[0][0] as any;
  expect(message.to).toBe("capture@example.invalid");
  expect(message.text).toContain("79,20");
  expect(message.text).toContain("unabhängig");
  expect(message.text).toContain("/auth/product?token_hash=");
  expect(state.patches[0].patch.status).toBe("sent");
});
it("does not create an auth account or send a receipt for an unpaid or refunded order", async () => {
  state.order.proof = null;
  expect(await processGuestMessages(provider)).toBe(0);
  expect(state.generate).not.toHaveBeenCalled();
  expect(provider.send).not.toHaveBeenCalled();
  state.order.proof = {};
  state.order.status = "refunded";
  expect(await processGuestMessages(provider)).toBe(0);
  expect(state.generate).not.toHaveBeenCalled();
  expect(provider.send).not.toHaveBeenCalled();
});
it("uses a login link for an existing account without confirming it on the server", async () => {
  state.generate.mockResolvedValueOnce({
    error: { message: "already registered" },
  });
  expect(await processGuestMessages(provider)).toBe(1);
  expect(state.generate.mock.calls.map((c) => c[0].type)).toEqual([
    "invite",
    "magiclink",
  ]);
});
it("retains failed messages for retry without changing purchase or family records", async () => {
  provider.send.mockRejectedValueOnce(Error("SMTP unavailable"));
  expect(await processGuestMessages(provider)).toBe(0);
  expect(state.patches).toHaveLength(1);
  expect(state.patches[0]).toMatchObject({
    table: "product_guest_messages",
    patch: { status: "failed" },
  });
});
it("keeps the purchased synthetic email when generating a link in an isolated local Auth database", async () => {
  vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "http://127.0.0.1:57321");
  expect(await processGuestMessages(provider)).toBe(1);
  expect(state.generate).toHaveBeenCalledWith({
    type: "invite",
    email: "purchaser@example.invalid",
  });
  expect((provider.send.mock.calls[0][0] as any).to).toBe(
    "capture@example.invalid",
  );
});

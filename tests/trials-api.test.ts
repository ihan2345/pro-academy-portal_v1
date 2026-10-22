import { beforeEach, afterEach, it, expect, vi } from "vitest";
const mocks = vi.hoisted(() => ({
  session: vi.fn(),
  from: vi.fn(),
  rpc: vi.fn(),
  cookieGet: vi.fn(),
  cookieSet: vi.fn(),
  limit: vi.fn(),
  generateLink: vi.fn(),
  verifyOtp: vi.fn(),
}));
vi.mock("../src/lib/server/service-db", () => ({
  serviceDb: () => ({
    from: mocks.from,
    rpc: mocks.rpc,
    auth: { admin: { generateLink: mocks.generateLink } },
  }),
}));
vi.mock("../src/lib/server/supabase", () => ({
  sessionUser: mocks.session,
  sessionDb: async () => ({ auth: { verifyOtp: mocks.verifyOtp } }),
}));
vi.mock("next/headers", () => ({
  cookies: async () => ({ get: mocks.cookieGet, set: mocks.cookieSet }),
}));
vi.mock("@opennextjs/cloudflare", () => ({
  getCloudflareContext: () => ({
    env: { CAMP_REQUEST_LIMIT: { limit: mocks.limit } },
  }),
}));
import { POST, GET } from "../src/app/api/probetraining/[action]/route";
import { NextRequest } from "next/server";
import { scopedTrialToken, readTrialGrant } from "../src/lib/trials/tokens";
import { trialApplicationSchema } from "../src/lib/trials/domain";
const family = "b0000000-0000-4000-8000-000000000010",
  secret = "a".repeat(64),
  origin = "https://portal.test.invalid";
const app = {
  request_id: family,
  parent_name: "Mina Beispiel",
  email: "parent@test.invalid",
  phone: "+4915112345678",
  children: [
    { first_name: "Emir", last_name: "Beispiel", birth_date: "2015-05-01" },
  ],
  operational_consent: true,
  privacy_acknowledged: true,
};
beforeEach(() => {
  vi.resetAllMocks();
  vi.stubEnv("TRIAL_TRAINING_ENABLED", "true");
  vi.stubEnv("APP_URL", origin);
  vi.stubEnv("SUPABASE_SERVICE_ROLE_KEY", secret);
  mocks.generateLink.mockResolvedValue({
    data: { properties: { hashed_token: "local-hash" } },
    error: null,
  });
  mocks.verifyOtp.mockResolvedValue({ error: null });
  mocks.limit.mockResolvedValue({ success: true });
  mocks.rpc.mockImplementation(async (name: string) => ({
    data: name === "trial_enabled" ? true : family,
    error: null,
  }));
});
afterEach(() => vi.unstubAllEnvs());
async function post(action: string, body: unknown, from = origin) {
  return POST(
    new NextRequest(`${origin}/api/probetraining/${action}`, {
      method: "POST",
      headers: {
        Origin: from,
        "Content-Type": "application/json",
        "cf-connecting-ip": "192.0.2.1",
      },
      body: JSON.stringify(body),
    }),
    { params: Promise.resolve({ action }) },
  );
}
it("validates required consent and the 1–3 player limit, rejects honeypots and never returns access credentials", async () => {
  expect(
    trialApplicationSchema.safeParse({ ...app, operational_consent: false })
      .success,
  ).toBe(false);
  expect(
    trialApplicationSchema.safeParse({
      ...app,
      children: Array(4).fill(app.children[0]),
    }).success,
  ).toBe(false);
  expect(
    trialApplicationSchema.safeParse({ ...app, website: "spam" }).success,
  ).toBe(false);
  const r = await post("apply", app);
  expect(r.status).toBe(200);
  expect(await r.json()).toEqual({ ok: true });
  expect(mocks.rpc).toHaveBeenCalledWith(
    "create_trial_request",
    expect.objectContaining({
      input: expect.objectContaining({ marketing_consent: false }),
    }),
  );
  expect((await post("apply", app, "https://foreign.invalid")).status).toBe(
    403,
  );
});
it("gates the feature and keeps team requests inaccessible to parents", async () => {
  vi.stubEnv("TRIAL_TRAINING_ENABLED", "false");
  expect((await post("apply", app)).status).toBe(404);
  expect(mocks.rpc).not.toHaveBeenCalled();
  vi.stubEnv("TRIAL_TRAINING_ENABLED", "true");
  mocks.session.mockResolvedValue({ role: "parent" });
  const r = await GET(new NextRequest(`${origin}/api/probetraining/team`), {
    params: Promise.resolve({ action: "team" }),
  });
  expect(r.status).toBe(403);
  expect(mocks.from).not.toHaveBeenCalled();
});
it("reports generic identity matches with verified Academy contacts", async () => {
  mocks.rpc.mockImplementation(async (name: string) =>
    name === "trial_enabled"
      ? { data: true, error: null }
      : { data: null, error: { message: "TRIAL_MATCH" } },
  );
  const r = await post("apply", app);
  expect(r.status).toBe(400);
  const text = (await r.json()).error;
  expect(text).toContain("contact@proacademy-ak.com");
  expect(text).toContain("+49 151 433 423 92");
  expect(text).not.toContain("TRIAL_MATCH");
});
it("honors the live Super-Admin switch and fails closed when its database check fails", async () => {
  for (const result of [
    { data: false, error: null },
    { data: true, error: { message: "offline" } },
    { data: "true", error: null },
  ]) {
    mocks.rpc.mockResolvedValue(result);
    expect((await post("apply", app)).status).toBe(404);
    expect(mocks.rpc).not.toHaveBeenCalledWith(
      "create_trial_request",
      expect.anything(),
    );
  }
  mocks.rpc.mockRejectedValue(Error("offline"));
  expect((await post("apply", app)).status).toBe(404);
});
it("uses single-use parent-bound login grants, keeps rating grants out of full login and attributes session feedback server-side", async () => {
  const grant = {
    purpose: "login" as const,
    family,
    parent: family,
    nonce: family,
    expires: Date.now() + 3600000,
  };
  const token = scopedTrialToken(grant, secret);
  expect(readTrialGrant(token, secret, "login")).toEqual(grant);
  expect(readTrialGrant(token + "x", secret, "login")).toBeNull();
  expect(readTrialGrant(token, secret, "rating")).toBeNull();
  expect(
    readTrialGrant(
      scopedTrialToken({ ...grant, expires: Date.now() - 1 }, secret),
      secret,
      "login",
    ),
  ).toBeNull();
  mocks.session.mockResolvedValue({ role: "parent", user: { id: family } });
  const chain = {
    select: () => chain,
    eq: () => chain,
    single: async () => ({
      data: {
        id: family,
        parent_id: family,
        email: "parent@test.invalid",
        created_at: new Date().toISOString(),
        email_verified_at: new Date().toISOString(),
        stopped_at: null,
        parent_rating: 5,
        event_id: family,
      },
      error: null,
    }),
  };
  mocks.from.mockReturnValue(chain);
  expect((await post("access", { token })).status).toBe(200);
  expect(mocks.rpc).toHaveBeenCalledWith("consume_trial_access", {
    nonce: family,
    family,
    parent: family,
  });
  expect(mocks.cookieSet).not.toHaveBeenCalled();
  await post("feedback", {
    action: "feedback",
    family_id: "forged",
    request_id: family,
    event_id: family,
    rating: 5,
  });
  expect(mocks.rpc).toHaveBeenLastCalledWith(
    "trial_parent_action",
    expect.objectContaining({ family }),
  );
  const ratingToken = scopedTrialToken(
    {
      purpose: "rating",
      family,
      parent: family,
      request: family,
      event: family,
      rating: 4,
      expires: Date.now() + 3600000,
    },
    secret,
  );
  mocks.session.mockClear();
  mocks.generateLink.mockClear();
  mocks.verifyOtp.mockClear();
  const rated = await post("rating", {
    token: ratingToken,
    family_id: "forged",
    request_id: "forged",
    rating: 1,
  });
  expect(rated.status).toBe(200);
  expect(mocks.rpc).toHaveBeenLastCalledWith("trial_parent_action", {
    family,
    input: expect.objectContaining({
      request_id: family,
      event_id: family,
      rating: 4,
    }),
  });
  expect(mocks.session).not.toHaveBeenCalled();
  expect(mocks.generateLink).not.toHaveBeenCalled();
  expect(mocks.verifyOtp).not.toHaveBeenCalled();
  expect((await post("access", { token: ratingToken })).status).toBe(401);
  expect((await post("rating", { token: token })).status).toBe(401);
  const read = await GET(
    new NextRequest(`${origin}/api/probetraining/access?token=${token}`),
    { params: Promise.resolve({ action: "access" }) },
  );
  expect(read.status).toBe(404);
  mocks.rpc.mockImplementation(async (name: string) =>
    name === "consume_trial_access"
      ? { error: { message: "used" }, data: null }
      : { error: null, data: name === "trial_enabled" ? true : family },
  );
  expect((await post("access", { token })).status).toBe(401);
});

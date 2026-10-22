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
import { trialToken, trialTokenFamily } from "../src/lib/trials/tokens";
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
  mocks.rpc.mockResolvedValue({ data: family, error: null });
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
  mocks.rpc.mockResolvedValue({
    data: null,
    error: { message: "TRIAL_MATCH" },
  });
  const r = await post("apply", app);
  expect(r.status).toBe(400);
  const text = (await r.json()).error;
  expect(text).toContain("contact@proacademy-ak.com");
  expect(text).toContain("+49 151 433 423 92");
  expect(text).not.toContain("TRIAL_MATCH");
});
it("verifies signed family access only through POST and binds feedback to the cookie family", async () => {
  const token = trialToken(family, secret);
  expect(trialTokenFamily(token, secret)).toBe(family);
  expect(trialTokenFamily(token.slice(0, -1) + "z", secret)).toBeNull();
  const chain = {
    select: () => chain,
    eq: () => chain,
    single: async () => ({
      data: {
        id: family,
        email_verified_at: new Date().toISOString(),
        access_expires_at: "2099-01-01",
        stopped_at: null,
      },
      error: null,
    }),
  };
  mocks.from.mockReturnValue(chain);
  const opened = await post("access", { token });
  expect(opened.status).toBe(200);
  expect(mocks.cookieSet).toHaveBeenCalledWith(
    "pa_trial",
    token,
    expect.objectContaining({ httpOnly: true, secure: true, sameSite: "lax" }),
  );
  mocks.cookieGet.mockReturnValue({ value: token });
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
  const read = await GET(
    new NextRequest(`${origin}/api/probetraining/access?token=${token}`),
    { params: Promise.resolve({ action: "access" }) },
  );
  expect(read.status).toBe(404);
});

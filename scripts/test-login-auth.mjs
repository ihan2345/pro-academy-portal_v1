// Real OTP contract against the existing LOCAL Supabase stack only. No mail sent.
import { execFileSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import assert from "node:assert/strict";
import { createClient } from "@supabase/supabase-js";
import { createServerClient } from "@supabase/ssr";
const raw = execFileSync(
  "supabase",
  ["status", "--workdir", "output/product-management-local", "-o", "json"],
  { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] },
);
const env = JSON.parse(raw.slice(raw.indexOf("{")));
const url = env.API_URL;
assert.equal(new URL(url).hostname, "127.0.0.1");
assert.equal(new URL(url).port, "57321");
const admin = createClient(url, env.SERVICE_ROLE_KEY, {
  auth: { persistSession: false, autoRefreshToken: false },
});
const email = `email-code-${randomUUID()}@example.invalid`;
let userId;
let signupUserId;
try {
  const created = await admin.auth.admin.createUser({
    email,
    email_confirm: true,
  });
  assert.equal(created.error, null);
  userId = created.data.user.id;
  const jar = new Map();
  const session = createServerClient(url, env.ANON_KEY, {
    cookies: {
      getAll: () => [...jar].map(([name, value]) => ({ name, value })),
      setAll: (values) =>
        values.forEach(({ name, value }) => jar.set(name, value)),
    },
  });
  const freshLink = async () => {
    const r = await admin.auth.admin.generateLink({ type: "magiclink", email });
    assert.equal(r.error, null);
    assert.match(r.data.properties.email_otp, /^[0-9]{6}$/);
    return r.data.properties;
  };
  const first = await freshLink();
  const verified = await session.auth.verifyOtp({
    email,
    token: first.email_otp,
    type: "email",
  });
  assert.equal(verified.error, null);
  assert.equal(verified.data.user.id, userId);
  assert(
    [...jar.keys()].some((name) => name.includes("auth-token")),
    "SSR writes session cookies",
  );
  const repeated = await session.auth.verifyOtp({
    email,
    token: first.email_otp,
    type: "email",
  });
  assert(repeated.error, "consumed code must not work twice");
  const other = createClient(url, env.ANON_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  assert(
    (
      await other.auth.verifyOtp({
        token_hash: first.hashed_token,
        type: "email",
      })
    ).error,
    "code consumption invalidates link",
  );
  const second = await freshLink();
  const linked = await other.auth.verifyOtp({
    token_hash: second.hashed_token,
    type: "email",
  });
  assert.equal(linked.error, null);
  assert.equal(linked.data.user.id, userId);
  assert(
    (
      await session.auth.verifyOtp({
        email,
        token: second.email_otp,
        type: "email",
      })
    ).error,
    "link consumption invalidates code",
  );
  assert(
    (await other.auth.verifyOtp({ email, token: "000000", type: "email" }))
      .error,
    "invalid code cannot authenticate",
  );
  const signupEmail = `email-signup-${randomUUID()}@example.invalid`;
  const signup = await admin.auth.admin.generateLink({
    type: "signup",
    email: signupEmail,
    password: randomUUID(),
  });
  assert.equal(signup.error, null);
  signupUserId = signup.data.user.id;
  assert.match(signup.data.properties.email_otp, /^[0-9]{6}$/);
  const confirmed = await other.auth.verifyOtp({
    email: signupEmail,
    token: signup.data.properties.email_otp,
    type: "email",
  });
  assert.equal(confirmed.error, null);
  assert.equal(confirmed.data.user.id, signupUserId);
  assert(
    confirmed.data.user.email_confirmed_at,
    "code confirms an invited first-time account",
  );
  console.log(
    "Local Supabase: six-digit OTP, SSR cookies, one-time use, code/link mutual invalidation invalid-code rejection and first-time email confirmation passed.",
  );
} finally {
  if (signupUserId)
    assert.equal((await admin.auth.admin.deleteUser(signupUserId)).error, null);
  if (userId)
    assert.equal((await admin.auth.admin.deleteUser(userId)).error, null);
}

import "server-only";
import { createHash, createHmac, timingSafeEqual } from "node:crypto";
import { z } from "zod";
import { required } from "./config";
import { assertRole, HttpError } from "./security";
import { serviceDb } from "./service-db";
import { collectRows } from "./pai/analytics";
import type { ProfileSession } from "./parent-profile";
import type { StripeNotice } from "../stripe-notices";

const identity = z
  .object({
    kind: z.enum(["billing", "review", "activity"]),
    id: z.string().min(1).max(200),
    fingerprint: z.string().regex(/^[a-f0-9]{64}$/),
    expires: z.number().int(),
  })
  .strict();
function signature(body: string) {
  return createHmac("sha256", required("SUPABASE_SERVICE_ROLE_KEY"))
    .update("stripe-notice-v1:" + body)
    .digest("base64url");
}
export function stripeNoticeIdentity(
  kind: StripeNotice["kind"],
  id: string,
  revision: unknown,
  now = Date.now(),
) {
  const fingerprint = createHash("sha256")
    .update(JSON.stringify(revision))
    .digest("hex");
  const body = Buffer.from(
    JSON.stringify({ kind, id, fingerprint, expires: now + 24 * 3600000 }),
  ).toString("base64url");
  return { fingerprint, token: body + "." + signature(body) };
}
export async function stripeNoticeDecisions(
  rows: (StripeNotice & { fingerprint: string })[],
) {
  if (!rows.length) return [];
  const db = serviceDb();
  const decisions: any[] = [];
  const ids = [...new Set(rows.map((r) => r.id))];
  for (let n = 0; n < ids.length; n += 100)
    decisions.push(
      ...(await collectRows(() =>
        db
          .from("stripe_notice_decisions")
          .select("kind,entity_id,fingerprint,state")
          .in("entity_id", ids.slice(n, n + 100)),
      )),
    );
  return rows.map(({ fingerprint, ...r }) => ({
    ...r,
    state:
      decisions.find(
        (d) =>
          d.kind === r.kind &&
          d.entity_id === r.id &&
          d.fingerprint === fingerprint,
      )?.state ?? "open",
  })) as StripeNotice[];
}
export async function decideStripeNotice(
  session: ProfileSession,
  input: unknown,
) {
  assertRole(session.role, "admin");
  const { token, state } = z
    .object({
      token: z.string().max(2000),
      state: z.enum(["done", "ignored", "open"]),
    })
    .strict()
    .parse(input);
  const [body, mac, ...extra] = token.split(".");
  const expected = Buffer.from(signature(body ?? ""));
  const supplied = Buffer.from(mac ?? "");
  if (
    extra.length ||
    expected.length !== supplied.length ||
    !timingSafeEqual(expected, supplied)
  )
    throw new HttpError(400, "Ungültige Meldung. Bitte neu laden.");
  let data: z.infer<typeof identity>;
  try {
    data = identity.parse(
      JSON.parse(Buffer.from(body, "base64url").toString("utf8")),
    );
  } catch {
    throw new HttpError(400, "Ungültige Meldung. Bitte neu laden.");
  }
  if (data.expires < Date.now())
    throw new HttpError(409, "Die Meldung ist abgelaufen. Bitte neu laden.");
  const actor = z.uuid().parse(session.user.id);
  const db = serviceDb();
  const key = {
    kind: data.kind,
    entity_id: data.id,
    fingerprint: data.fingerprint,
  };
  const result =
    state === "open"
      ? await db.from("stripe_notice_decisions").delete().match(key)
      : await db.from("stripe_notice_decisions").upsert(
          {
            ...key,
            state,
            actor_id: actor,
            updated_at: new Date().toISOString(),
          },
          { onConflict: "kind,entity_id,fingerprint" },
        );
  if (result.error)
    throw new HttpError(
      503,
      "Bearbeitungsstand konnte nicht gespeichert werden. Bitte erneut versuchen.",
    );
  return { ok: true, state };
}

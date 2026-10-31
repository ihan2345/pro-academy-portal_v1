import "server-only";
import { z } from "zod";
import type { ProfileSession } from "@/lib/server/parent-profile";
import { serviceDb } from "@/lib/server/service-db";
import { checked } from "@/lib/server/products/context";
import { productLiveMode } from "@/lib/server/products/runtime";
import { HttpError } from "@/lib/server/security";
import { giftCodeSchema } from "./domain";
import { giftCodeHash, giftHash, openGift } from "./crypto";
import { requireGifts } from "./runtime";
import { presentGiftStatus } from "./status";
export function requireGiftParent(
  session: ProfileSession | null,
): asserts session is ProfileSession {
  requireGifts();
  if (!session?.user)
    throw new HttpError(401, "Bitte mit deinem Elternkonto anmelden.");
  if (session.role !== "parent" || !session.user.email_confirmed_at)
    throw new HttpError(403, "Bitte dein bestätigtes Elternkonto verwenden.");
}
async function welcomeKey(s: ProfileSession) {
  // Session ID is used only for the presentation marker; authorization uses the verified sessionUser.
  const r = await s.db.auth.getSession();
  let sid = s.user.last_sign_in_at ?? "session";
  try {
    const token = r.data.session?.access_token;
    if (token) {
      const p = JSON.parse(
        Buffer.from(token.split(".")[1], "base64url").toString(),
      );
      if (typeof p.session_id === "string") sid = p.session_id;
    }
  } catch {}
  return giftHash(`${s.user.id}:${sid}`);
}
async function presentAccount(s: ProfileSession, raw: any) {
  return {
    ...raw,
    user_id: s.user.id,
    welcome_key: await welcomeKey(s),
    cards: raw.cards.map((c: any) => {
      const { code_cipher, ...rest } = c;
      return { ...rest, code: code_cipher ? openGift(code_cipher) : null };
    }),
  };
}
export async function giftAccount(session: ProfileSession | null) {
  requireGiftParent(session);
  const raw = checked<any>(
    await serviceDb().rpc("gift_account_state", {
      input: { auth_id: session.user.id, livemode: productLiveMode() },
    }),
  );
  return presentAccount(session, raw);
}
export async function linkGiftAccount(
  session: ProfileSession | null,
  raw: unknown,
) {
  requireGiftParent(session);
  const { value } = z
    .object({ value: z.string().trim().min(1).max(1500) })
    .strict()
    .parse(raw);
  let proof: Record<string, string>;
  if (/^https?:\/\//i.test(value) || value.startsWith("/bestellstatus?")) {
    let u: URL;
    try {
      u = new URL(value, process.env.APP_URL!);
    } catch {
      throw new HttpError(
        400,
        "Bitte einen gültigen persönlichen Statuslink angeben.",
      );
    }
    const origin = new URL(process.env.APP_URL!).origin;
    if (
      u.origin !== origin ||
      !["/bestellstatus", "/geschenkkarte"].includes(u.pathname)
    )
      throw new HttpError(400, "Bitte deinen ProAcademy Statuslink verwenden.");
    const order = z
        .uuid()
        .parse(u.searchParams.get("order") ?? u.searchParams.get("purchase")),
      key = z.string().min(1).max(100).parse(u.searchParams.get("key"));
    proof = { order_id: order, status_hash: giftHash(key) };
  } else proof = { code_hash: giftCodeHash(giftCodeSchema.parse(value)) };
  const r = await serviceDb().rpc("gift_account_link", {
    input: { ...proof, auth_id: session.user.id, livemode: productLiveMode() },
  });
  if (r.error) throw new HttpError(409, r.error.message);
  return presentAccount(session, r.data);
}
export async function giftAccountDetail(
  session: ProfileSession | null,
  id: string,
) {
  requireGiftParent(session);
  z.uuid().parse(id);
  const db = serviceDb();
  const links = checked<any[]>(
    await db
      .from("gift_account_links")
      .select("scope")
      .eq("auth_id", session.user.id)
      .eq("order_id", id),
  );
  if (!links.length) throw new HttpError(404, "Geschenkkarte nicht gefunden.");
  const o = checked<any>(
    await db
      .from("gift_orders")
      .select("*")
      .eq("id", id)
      .eq("livemode", productLiveMode())
      .maybeSingle(),
  );
  if (!o) throw new HttpError(404, "Geschenkkarte nicht gefunden.");
  return presentGiftStatus(
    o,
    links.some((l) => l.scope === "recipient") ? "recipient" : "buyer",
  );
}

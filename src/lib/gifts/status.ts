import "server-only";
import { serviceDb } from "@/lib/server/service-db";
import { checked } from "@/lib/server/products/context";
import { productLiveMode } from "@/lib/server/products/runtime";
import { HttpError } from "@/lib/server/security";
import { giftHash, newGiftSecret, sealGift, openGift } from "./crypto";
import { requireGifts } from "./runtime";
export type GiftStatusScope = "buyer" | "recipient";
export async function ensureGiftRecipientAccess(order: any) {
  if (order.recipient_access_cipher) return order;
  const secret = newGiftSecret();
  return checked<any>(
    await serviceDb().rpc("gift_ensure_recipient_access", {
      input: { id: order.id, hash: giftHash(secret), cipher: sealGift(secret) },
    }),
  );
}
export function giftStatusLink(order: any, scope: GiftStatusScope) {
  const url = new URL("/bestellstatus", process.env.APP_URL!);
  url.searchParams.set("order", order.id);
  url.searchParams.set(
    "key",
    openGift(
      scope === "buyer" ? order.access_cipher : order.recipient_access_cipher,
    ),
  );
  return url.href;
}
export async function giftStatusView(id: string, key: string) {
  requireGifts();
  if (!/^[0-9a-f-]{36}$/i.test(id) || !key || key.length > 100)
    throw new HttpError(404, "Bestellstatus nicht gefunden.");
  const db = serviceDb(),
    hash = giftHash(key),
    o = checked<any>(
      await db
        .from("gift_orders")
        .select("*")
        .eq("id", id)
        .eq("livemode", productLiveMode())
        .or(`access_hash.eq.${hash},recipient_access_hash.eq.${hash}`)
        .maybeSingle(),
    );
  if (!o) throw new HttpError(404, "Bestellstatus nicht gefunden.");
  const viewer: GiftStatusScope =
    o.recipient_access_hash === hash ? "recipient" : "buyer";
  return presentGiftStatus(o, viewer);
}
export async function presentGiftStatus(o: any, viewer: GiftStatusScope) {
  const db = serviceDb(),
    id = o.id;
  const g = checked<any>(
    await db.from("gift_cards").select("*").eq("order_id", id).maybeSingle(),
  );
  const messages = checked<any[]>(
    await db
      .from("gift_messages")
      .select("audience,status,sent_at")
      .eq("order_id", id),
  );
  const base = {
    id: o.id,
    viewer,
    status: o.status,
    initial_amount: o.amount,
    amount: o.amount,
    currency: o.currency,
    buyer_name: o.buyer.full_name,
    recipient: {
      first_name: o.recipient.first_name,
      last_name: o.recipient.last_name,
      email: o.recipient.email,
    },
    paid_at: o.paid_at,
    expires_at: g?.expires_at ?? null,
    messages,
    appearance: o.appearance,
    invoice_url: viewer === "buyer" ? (o.invoice_url ?? null) : null,
    checkout_url:
      viewer === "buyer" && o.status === "checkout" ? o.checkout_url : null,
  };
  if (viewer === "buyer")
    return {
      ...base,
      code:
        g?.status === "issued" &&
        g.remaining === g.amount &&
        g.code_cipher === (g.initial_code_cipher ?? g.code_cipher)
          ? openGift(g.initial_code_cipher ?? g.code_cipher)
          : null,
      gift_status: g ? "issued" : null,
    };
  const uses = g
    ? checked<any[]>(
        await db
          .from("gift_code_uses")
          .select(
            "intent_id,amount,state,before_balance,after_balance,spent_at,returned_at,refund_before_balance,refund_after_balance,product_purchase_intents!inner(product)",
          )
          .eq("gift_id", g.id)
          .in("state", ["spent", "returned"])
          .order("spent_at", { ascending: false }),
      )
    : [];
  const active =
    g?.status === "issued" &&
    g.remaining > 0 &&
    Date.parse(g.expires_at) > Date.now();
  return {
    ...base,
    amount: g?.remaining ?? o.amount,
    remaining: g?.remaining ?? 0,
    reserved: g?.reserved ?? 0,
    code: active ? openGift(g.code_cipher) : null,
    gift_status: !g
      ? null
      : g.status !== "issued"
        ? g.status
        : g.remaining === 0
          ? "spent"
          : Date.parse(g.expires_at) <= Date.now()
            ? "expired"
            : g.reserved > 0
              ? "reserved"
              : "issued",
    history: uses
      .flatMap((u: any) => {
        const common = {
          order_id: u.intent_id,
          product_name: u.product_purchase_intents.product.name,
          used_amount: u.amount,
        };
        return [
          {
            ...common,
            before_balance: u.before_balance,
            after_balance: u.after_balance,
            date: u.spent_at,
            state: "spent",
          },
          ...(u.state === "returned"
            ? [
                {
                  ...common,
                  before_balance: u.refund_before_balance,
                  after_balance: u.refund_after_balance,
                  date: u.returned_at,
                  state: "returned",
                },
              ]
            : []),
        ];
      })
      .sort((a: any, b: any) => Date.parse(a.date) - Date.parse(b.date)),
  };
}
export async function requestGiftStatusLink(
  id: string,
  email: string,
  _scope?: GiftStatusScope,
) {
  requireGifts();
  const db = serviceDb(),
    o = checked<any>(
      await db
        .from("gift_orders")
        .select("*")
        .eq("id", id)
        .eq("livemode", productLiveMode())
        .maybeSingle(),
    );
  const reply = {
    queued: true,
    message:
      "Wenn Bestellnummer und E-Mail-Adresse passen, erhältst du deinen persönlichen Statuslink.",
  };
  const mail = email.trim().toLowerCase();
  const scope: GiftStatusScope | null = !o
    ? null
    : o.recipient.email.trim().toLowerCase() === mail
      ? "recipient"
      : o.buyer.email.trim().toLowerCase() === mail
        ? "buyer"
        : null;
  if (!o || !scope) return reply;
  const audience = `status_${scope}`,
    prior = checked<any>(
      await db
        .from("gift_messages")
        .select("status,available_at,sent_at")
        .eq("order_id", id)
        .eq("audience", audience)
        .maybeSingle(),
    );
  if (!prior)
    checked(await db.from("gift_messages").insert({ order_id: id, audience }));
  else if (
    prior.status !== "processing" &&
    Date.parse(prior.sent_at ?? prior.available_at) < Date.now() - 60000
  )
    checked(
      await db
        .from("gift_messages")
        .update({
          status: "pending",
          attempts: 0,
          available_at: new Date().toISOString(),
        })
        .eq("order_id", id)
        .eq("audience", audience),
    );
  return reply;
}

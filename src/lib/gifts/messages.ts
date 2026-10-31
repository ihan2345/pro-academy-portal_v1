import "server-only";
import { randomUUID } from "node:crypto";
import type { MailProvider } from "@/lib/mail";
import { safeRecipient } from "@/lib/mail";
import { serviceDb } from "@/lib/server/service-db";
import { checked } from "@/lib/server/products/context";
import { productLiveMode } from "@/lib/server/products/runtime";
import { giftsEnabled } from "./runtime";
import { openGift } from "./crypto";
import { giftMailArtwork } from "./artwork-mail";
import { ensureGiftRecipientAccess, giftStatusLink } from "./status";
import {
  giftMailContent,
  withGiftImages,
  type GiftMailKind,
} from "./mail-content";
export async function processGiftMessages(provider: MailProvider) {
  if (!giftsEnabled() || process.env.GIFT_MAIL_ENABLED !== "true") return 0;
  const db = serviceDb(),
    owner = randomUUID();
  const [initial, balance] = await Promise.all([
    db.rpc("gift_claim_messages", { mode: productLiveMode(), owner }),
    db.rpc("gift_claim_balance_messages", { mode: productLiveMode(), owner }),
  ]);
  const jobs = [
    ...checked<any[]>(initial),
    ...checked<any[]>(balance).map((j) => ({ ...j, audience: "balance" })),
  ];
  const artwork = new Map<string, ReturnType<typeof giftMailArtwork>>();
  let sent = 0;
  for (const job of jobs) {
    const isBalance = job.audience === "balance",
      isStatus = job.audience.startsWith("status_");
    const update = (value: Record<string, unknown>) => {
      let q = db
        .from(isBalance ? "gift_balance_messages" : "gift_messages")
        .update(value);
      q = isBalance
        ? q.eq("intent_id", job.intent_id)
        : q.eq("order_id", job.order_id).eq("audience", job.audience);
      return q.eq("lease_token", owner);
    };
    try {
      if (job.audience.startsWith("access_")) {
        checked(await update({ status: "cancelled" }));
        continue;
      }
      let order = checked<any>(
        await db
          .from("gift_orders")
          .select("*")
          .eq("id", job.order_id)
          .single(),
      );
      const gift = checked<any>(
        await db
          .from("gift_cards")
          .select("*")
          .eq("order_id", order.id)
          .maybeSingle(),
      );
      if (
        !isStatus &&
        (order.status !== "issued" ||
          !gift ||
          !["issued", "claimed"].includes(gift.status))
      ) {
        checked(await update({ status: "cancelled" }));
        continue;
      }
      if (
        job.audience === "buyer" &&
        order.buyer.email.toLowerCase() === order.recipient.email.toLowerCase()
      ) {
        checked(await update({ status: "cancelled" }));
        continue;
      }
      if (
        isBalance &&
        (gift.status !== "issued" ||
          gift.remaining !== job.after_balance ||
          gift.code_hash !== job.code_hash ||
          gift.remaining <= 0)
      ) {
        checked(await update({ status: "cancelled" }));
        continue;
      }
      order = await ensureGiftRecipientAccess(order);
      const scope =
        job.audience === "buyer" || job.audience === "status_buyer"
          ? "buyer"
          : "recipient";
      const kind = job.audience as GiftMailKind,
        url = giftStatusLink(order, scope);
      const recipient =
        scope === "buyer" ? order.buyer.email : order.recipient.email;
      const cipher = isStatus
        ? null
        : isBalance
          ? job.code_cipher
          : kind === "buyer"
            ? (gift.initial_code_cipher ?? gift.code_cipher)
            : gift.code_cipher;
      const code = cipher ? openGift(cipher) : undefined;
      const purchase = isBalance
        ? checked<any>(
            await db
              .from("product_purchase_intents")
              .select("id,status,product,expected_amount,gift_credit_amount")
              .eq("id", job.intent_id)
              .single(),
          )
        : null;
      if (isBalance && purchase.status !== "fulfilled") {
        checked(await update({ status: "cancelled" }));
        continue;
      }
      const content = giftMailContent({
        kind,
        order,
        gift,
        url,
        code,
        event: job,
        purchase,
      });
      let attachments;
      if (
        !kind.startsWith("status_") &&
        !(kind === "recipient" && gift.remaining === 0)
      ) {
        const amount = isBalance
            ? job.after_balance
            : kind === "buyer"
              ? gift.amount
              : (gift.remaining ?? gift.amount),
          key = `${order.id}:${amount}:${cipher}`;
        let rendering = artwork.get(key);
        if (!rendering) {
          rendering = giftMailArtwork({
            amount,
            code: code!,
            recipient_name: [
              order.recipient.first_name,
              order.recipient.last_name,
            ]
              .filter(Boolean)
              .join(" "),
            sender_name: order.buyer.full_name,
            expires_at: gift.expires_at,
          });
          artwork.set(key, rendering);
          rendering.catch(() => artwork.delete(key));
        }
        attachments = await rendering;
      }
      await provider.send({
        to: safeRecipient(recipient),
        ...content,
        html: attachments ? withGiftImages(content.html) : content.html,
        attachments,
        messageId: `<gift-${order.id}-${isBalance ? `balance-${job.intent_id}` : job.audience}@proacademy-ak.com>`,
      });
      checked(
        await update({
          status: provider.name === "capture" ? "captured" : "sent",
          sent_at: new Date().toISOString(),
          lease_token: null,
        }),
      );
      sent++;
    } catch {
      checked(
        await update({
          status: "failed",
          available_at: new Date(
            Date.now() + Math.min(3600, 30 * 2 ** job.attempts) * 1000,
          ).toISOString(),
          lease_token: null,
        }),
      );
    }
  }
  return sent;
}

import "server-only";
import type Stripe from "stripe";
import { checked } from "@/lib/server/products/context";
import { serviceDb } from "@/lib/server/service-db";
import { productLiveMode } from "@/lib/server/products/runtime";
import { HttpError } from "@/lib/server/security";
const version = { apiVersion: "2026-10-28.endive" };
/** Return a gift contribution only after a fully verified cash refund (if any).
 * Explicit admin returns without cash are supported; contracts are never cancelled here. */
export async function reconcileGiftRefund(
  i: any,
  stripe: Stripe,
  requestReturn = false,
) {
  const db = serviceDb();
  let b = checked<any>(
    await db
      .from("gift_billings")
      .select("*")
      .eq("intent_id", i.id)
      .maybeSingle(),
  );
  if (!b || b.state === "returned") return b?.state === "returned";
  if (b.state !== "settled" || b.livemode !== productLiveMode())
    throw Error("Guthabenzahlung ist nicht abgeschlossen");
  let record: any = await stripe.rawRequest(
    "GET",
    `/v1/payment_records/${b.payment_record_id}`,
    {},
    version,
  );
  if (
    record.livemode !== productLiveMode() ||
    record.amount_guaranteed?.value !== i.gift_credit_amount ||
    record.amount_guaranteed?.currency !== i.currency ||
    record.processor_details?.custom?.payment_reference !== i.id
  )
    throw Error("Guthaben-Erstattungsnachweis passt nicht");
  const refunds: Stripe.CreditNoteCreateParams.Refund[] = [];
  if (i.expected_amount > 0) {
    const pi = await stripe.paymentIntents.retrieve(b.cash_payment_id, {
      expand: ["latest_charge"],
    });
    const c = typeof pi.latest_charge === "object" ? pi.latest_charge : null;
    if (
      pi.livemode !== productLiveMode() ||
      pi.currency !== i.currency ||
      pi.amount_received !== i.expected_amount ||
      !c?.paid ||
      c.livemode !== productLiveMode()
    )
      throw Error("Zuzahlung passt nicht zur Erstattung");
    if (!c.refunded || c.amount_refunded !== i.expected_amount) {
      if (requestReturn)
        throw new HttpError(
          409,
          "Bitte zuerst die vollständige Zuzahlung in Stripe erstatten. Das Geschenkguthaben wird danach zurückgebucht.",
        );
      return false;
    }
    let sum = 0;
    for await (const r of stripe.refunds.list({
      payment_intent: pi.id,
      limit: 100,
    }))
      if (r.status === "succeeded") {
        sum += r.amount;
        refunds.push({ refund: r.id, amount_refunded: r.amount });
      }
    if (sum !== i.expected_amount)
      throw Error("Vollständiger Erstattungsbetrag ist nicht bestätigt");
  } else if (!requestReturn && !record.amount_refunded?.value) return false;
  if (
    record.amount_refunded?.value &&
    record.amount_refunded.value !== i.gift_credit_amount
  )
    throw new HttpError(
      409,
      "Teilweise Guthabenerstattung benötigt eine manuelle Prüfung.",
    );
  b = checked<any>(await db.rpc("gift_start_return", { input: { id: i.id } }));
  if (!b.credit_note_id) {
    const invoice = await stripe.invoices.retrieve(b.invoice_id);
    if (
      invoice.livemode !== productLiveMode() ||
      invoice.currency !== i.currency ||
      invoice.total !== i.expected_amount + i.gift_credit_amount
    )
      throw Error("Erstattungsrechnung passt nicht");
    const tax = invoice.total_taxes?.find((t) => t.type === "tax_rate_details")
      ?.tax_rate_details?.tax_rate;
    if (i.expected_amount > 0 && !tax)
      throw Error("Steuerzuordnung der Erstattung fehlt");
    let note: Stripe.CreditNote | undefined;
    for await (const n of stripe.creditNotes.list({
      invoice: b.invoice_id,
      limit: 100,
    }))
      if (n.status === "issued" && n.metadata?.product_intent_id === i.id) {
        note = n;
        break;
      }
    if (!note)
      note = await stripe.creditNotes.create(
        {
          invoice: b.invoice_id,
          lines: [
            ...(i.expected_amount > 0
              ? [
                  {
                    type: "custom_line_item" as const,
                    description:
                      "Erstattung der zusätzlichen Zahlung · 19 % USt. enthalten",
                    quantity: 1,
                    unit_amount: i.expected_amount,
                    tax_rates: [tax!],
                  },
                ]
              : []),
            {
              type: "custom_line_item",
              description:
                "Rückbuchung des bereits versteuerten Geschenkguthabens",
              quantity: 1,
              unit_amount: i.gift_credit_amount,
              tax_rates: [],
            },
          ],
          out_of_band_amount: i.gift_credit_amount,
          refunds: refunds.sort((a, b) => a.refund!.localeCompare(b.refund!)),
          email_type: "none",
          reason: "order_change",
          memo: "Geschenkguthaben zurückgebucht; eine zusätzliche Kartenzahlung wurde separat erstattet. Die ursprüngliche Gültigkeit des Geschenks bleibt bestehen.",
          metadata: { product_intent_id: i.id },
        },
        { idempotencyKey: `gift-invoice:${i.id}:credit-note` },
      );
    if (
      note.livemode !== productLiveMode() ||
      note.amount !== i.expected_amount + i.gift_credit_amount ||
      note.currency !== i.currency
    )
      throw Error("Erstattungsbeleg passt nicht");
    const taxAmount = (values: any[] | null | undefined) =>
      (values ?? []).reduce((sum, t) => sum + t.amount, 0);
    if (taxAmount(note.total_taxes) !== taxAmount(invoice.total_taxes))
      throw Error("Umsatzsteuer des Erstattungsbelegs weicht ab");
    checked(
      await db
        .from("gift_billings")
        .update({ credit_note_id: note.id })
        .eq("intent_id", i.id),
    );
    b.credit_note_id = note.id;
  }
  if (!record.amount_refunded?.value) {
    const t = Math.floor(Date.parse(b.return_started_at) / 1000);
    record = await stripe.rawRequest(
      "POST",
      `/v1/payment_records/${b.payment_record_id}/report_refund`,
      {
        amount: { currency: i.currency, value: i.gift_credit_amount },
        processor_details: {
          type: "custom",
          custom: { refund_reference: i.id },
        },
        outcome: "refunded",
        refunded: { refunded_at: t },
      },
      { ...version, idempotencyKey: `gift-invoice:${i.id}:return-gift` },
    );
  }
  if (record.amount_refunded?.value !== i.gift_credit_amount)
    throw Error("Guthabenrückzahlung ist nicht bestätigt");
  checked(
    await db.rpc("gift_complete_return", {
      input: {
        id: i.id,
        record_id: b.payment_record_id,
        credit_note_id: b.credit_note_id,
        amount: i.gift_credit_amount,
        actor_id: i.refund_actor,
        reason: i.refund_reason,
      },
    }),
  );
  return true;
}

/** Full refund of the original, VAT-inclusive single-purpose voucher purchase. */
export async function creditGiftPurchase(
  o: any,
  invoiceId: string,
  stripe: Stripe,
) {
  const invoice = await stripe.invoices.retrieve(invoiceId);
  const tax = invoice.total_taxes?.find((t) => t.type === "tax_rate_details")
    ?.tax_rate_details?.tax_rate;
  if (
    invoice.livemode !== productLiveMode() ||
    invoice.total !== o.amount ||
    invoice.currency !== o.currency ||
    !tax
  )
    throw Error("Gutschein-Erstattungsrechnung passt nicht");
  const refunds: Stripe.CreditNoteCreateParams.Refund[] = [];
  let total = 0;
  for await (const r of stripe.refunds.list({
    payment_intent: o.payment_id,
    limit: 100,
  }))
    if (r.status === "succeeded") {
      total += r.amount;
      refunds.push({ refund: r.id, amount_refunded: r.amount });
    }
  if (total !== o.amount)
    throw Error("Vollständige Erstattung des Geschenkkaufs fehlt");
  let note: Stripe.CreditNote | undefined;
  for await (const n of stripe.creditNotes.list({
    invoice: invoiceId,
    limit: 100,
  }))
    if (n.status === "issued" && n.metadata?.gift_order_id === o.id) {
      note = n;
      break;
    }
  note ??= await stripe.creditNotes.create(
    {
      invoice: invoiceId,
      lines: [
        {
          type: "custom_line_item",
          description:
            "Erstattung des Einzweckgutscheins · 19 % USt. enthalten",
          quantity: 1,
          unit_amount: o.amount,
          tax_rates: [tax],
        },
      ],
      refunds: refunds.sort((a, b) => a.refund!.localeCompare(b.refund!)),
      email_type: "none",
      reason: "order_change",
      metadata: { gift_order_id: o.id },
    },
    { idempotencyKey: `gift-purchase:${o.id}:credit-note` },
  );
  if (
    note.livemode !== productLiveMode() ||
    note.currency !== o.currency ||
    note.amount !== o.amount ||
    (note.total_taxes ?? []).reduce((v, t) => v + t.amount, 0) !==
      (invoice.total_taxes ?? []).reduce((v, t) => v + t.amount, 0)
  )
    throw Error("Gutschein-Erstattungsbeleg passt nicht");
  checked(
    await serviceDb()
      .from("gift_orders")
      .update({ credit_note_id: note.id })
      .eq("id", o.id),
  );
}

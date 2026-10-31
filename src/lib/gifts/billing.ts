import "server-only";
import type Stripe from "stripe";
import { serviceDb } from "@/lib/server/service-db";
import { checked } from "@/lib/server/products/context";
import { productLiveMode } from "@/lib/server/products/runtime";
import { HttpError } from "@/lib/server/security";
import { giftMoney } from "./domain";
import { requireGifts } from "./runtime";
const recordVersion = { apiVersion: "2026-10-28.endive" };
const ref = (v: any): string | undefined => (typeof v === "string" ? v : v?.id);
const configs = new Map<
  boolean,
  Promise<{ tax: string; clearing: string; value: string }>
>();
/** Declared business basis: all redeemable services take place in Germany and include 19% VAT.
 * Single-purpose voucher VAT is accounted for on issue; the first invoice clears prepaid VAT.
 * No customer-wide invoice balance is changed. */
export async function giftBillingConfig(stripe: Stripe) {
  requireGifts();
  const mode = productLiveMode();
  let cached = configs.get(mode);
  if (!cached) {
    cached = (async () => {
      let tax: Stripe.TaxRate | undefined;
      for await (const rate of stripe.taxRates.list({
        active: true,
        limit: 100,
      })) {
        if (
          rate.metadata?.pa_gift === "de_19_inclusive" &&
          rate.country === "DE" &&
          rate.percentage === 19 &&
          rate.inclusive &&
          rate.livemode === mode
        ) {
          tax = rate;
          break;
        }
      }
      tax ??= await stripe.taxRates.create(
        {
          display_name: "USt.",
          description: "Deutschland · 19 % im Preis enthalten",
          percentage: 19,
          inclusive: true,
          country: "DE",
          metadata: { pa_gift: "de_19_inclusive" },
        },
        { idempotencyKey: `pa-gift:${mode}:de19-tax` },
      );
      if (tax.livemode !== mode)
        throw Error("Gutschein-Steuerumgebung passt nicht");
      async function product(kind: string, name: string) {
        const id = `prod_pa_gift_${mode ? "live" : "test"}_${kind}`;
        try {
          const p = await stripe.products.retrieve(id);
          if (
            p.deleted ||
            !p.active ||
            p.livemode !== mode ||
            p.metadata.pa_gift_component !== kind
          )
            throw Error("Gutschein-Verrechnungskonto passt nicht");
          return id;
        } catch (e: any) {
          if (e?.code !== "resource_missing") throw e;
        }
        const p = await stripe.products.create(
          { id, name, metadata: { pa_gift_component: kind } },
          { idempotencyKey: `${id}:create` },
        );
        if (p.livemode !== mode)
          throw Error("Gutschein-Verrechnungsumgebung passt nicht");
        return p.id;
      }
      const [clearing, value] = await Promise.all([
        product(
          "vat_clearing",
          "Bereits versteuerter Einzweckgutschein · steuerliche Verrechnung",
        ),
        product(
          "prepaid_value",
          "Geschenkguthaben · Verrechnungswert ohne erneute Umsatzsteuer",
        ),
      ]);
      return { tax: tax.id, clearing, value };
    })();
    configs.set(mode, cached);
    cached.catch(() => configs.delete(mode));
  }
  return cached;
}
export function giftCheckoutParams(
  i: any,
  customer: string,
): Stripe.Checkout.SessionCreateParams {
  const setup = i.product.kind === "subscription" && i.expected_amount === 0;
  const description = `${i.product.name}: ${giftMoney(i.expected_amount + i.gift_credit_amount)} nach Preisvorteilen. Davon ${giftMoney(i.gift_credit_amount)} Geschenkguthaben; jetzt zu zahlen ${giftMoney(i.expected_amount)}.`;
  const origin = new URL(process.env.APP_URL!).origin;
  return {
    mode: setup ? "setup" : "payment",
    customer,
    client_reference_id: i.id,
    metadata: { product_intent_id: i.id, gift_payment: "invoice_v1" },
    ...(setup
      ? { setup_intent_data: { metadata: { product_intent_id: i.id } } }
      : {
          adaptive_pricing: { enabled: false },
          line_items: [
            {
              price_data: {
                currency: i.currency,
                unit_amount: i.expected_amount,
                product_data: {
                  name: `${i.product.name} · ${i.expected_amount ? "Zuzahlung" : "Guthabenzahlung"}`,
                  description,
                  metadata: {
                    product_intent_id: i.id,
                    original_price_id: i.product.price.id,
                  },
                },
              },
              quantity: 1,
            },
          ],
          payment_intent_data: {
            metadata: {
              product_intent_id: i.id,
              pa_gift_payment: "invoice_v1",
            },
            ...(i.product.kind === "subscription"
              ? { setup_future_usage: "off_session" as const }
              : {}),
          },
        }),
    custom_text: {
      submit: {
        message:
          description +
          (i.product.kind === "subscription"
            ? " Die hinterlegte Karte wird für die folgenden regulären Abo-Rechnungen verwendet."
            : ""),
      },
    },
    billing_address_collection: "required",
    payment_method_types: ["card"],
    success_url: `${origin}/produkte?purchase=${i.id}`,
    cancel_url: `${origin}/produkte?purchase=${i.id}`,
    expires_at: Math.floor(Date.parse(i.expires_at) / 1000),
    locale: "de",
  };
}
export type GiftPaymentProof = {
  proof: any;
  paymentId: string;
  subscription?: Stripe.Subscription;
  item?: Stripe.SubscriptionItem;
};
/** Verify actual Checkout money movement before creating or settling any full-value invoice. */
export async function nativeGiftPayment(
  i: any,
  stripe: Stripe,
): Promise<GiftPaymentProof | { status: string }> {
  requireGifts();
  const db = serviceDb();
  const s = await stripe.checkout.sessions.retrieve(i.session_id);
  const setup = i.product.kind === "subscription" && i.expected_amount === 0;
  if (
    s.livemode !== productLiveMode() ||
    ref(s.customer) !== i.customer_id ||
    s.client_reference_id !== i.id ||
    s.metadata?.product_intent_id !== i.id ||
    s.metadata?.gift_payment !== "invoice_v1" ||
    s.mode !== (setup ? "setup" : "payment")
  )
    throw new HttpError(409, "Guthaben-Checkout passt nicht zum Kaufauftrag.");
  if (s.status === "expired") {
    checked(
      await db
        .from("product_purchase_intents")
        .update({ status: "expired", updated_at: new Date().toISOString() })
        .eq("id", i.id)
        .neq("status", "fulfilled"),
    );
    return { status: "expired" };
  }
  if (
    s.status !== "complete" ||
    (!setup &&
      ![
        "paid",
        ...(i.expected_amount === 0 ? ["no_payment_required"] : []),
      ].includes(s.payment_status))
  )
    return { status: "pending_payment" };
  let payment: Stripe.PaymentIntent | undefined, method: string | undefined;
  if (setup) {
    const si = await stripe.setupIntents.retrieve(ref(s.setup_intent)!);
    if (
      si.status !== "succeeded" ||
      si.livemode !== productLiveMode() ||
      ref(si.customer) !== i.customer_id
    )
      throw Error("Zahlungsmittel ist nicht bestätigt");
    method = ref(si.payment_method);
  } else {
    const lines = await stripe.checkout.sessions.listLineItems(s.id, {
      limit: 2,
      expand: ["data.price.product"],
    });
    const line = lines.data[0],
      p = line?.price?.product;
    if (
      lines.has_more ||
      lines.data.length !== 1 ||
      line.quantity !== 1 ||
      !line.price ||
      typeof p !== "object" ||
      p.deleted ||
      p.metadata.product_intent_id !== i.id ||
      p.metadata.original_price_id !== i.product.price.id ||
      line.price.unit_amount !== i.expected_amount ||
      s.amount_total !== i.expected_amount ||
      s.amount_subtotal !== i.expected_amount ||
      s.currency !== i.currency ||
      s.total_details?.amount_discount ||
      s.total_details?.amount_tax ||
      s.total_details?.amount_shipping
    )
      throw Error(
        "Zuzahlung oder Artikel stimmt nicht mit dem Auftrag überein",
      );
    if (i.expected_amount > 0) {
      payment = await stripe.paymentIntents.retrieve(ref(s.payment_intent)!, {
        expand: ["latest_charge"],
      });
      const charge =
        typeof payment.latest_charge === "object"
          ? payment.latest_charge
          : null;
      if (
        payment.status !== "succeeded" ||
        payment.livemode !== productLiveMode() ||
        ref(payment.customer) !== i.customer_id ||
        payment.amount_received !== i.expected_amount ||
        payment.currency !== i.currency ||
        !charge?.paid ||
        charge.refunded ||
        charge.disputed ||
        charge.amount_refunded ||
        charge.amount !== i.expected_amount ||
        charge.livemode !== productLiveMode()
      )
        throw Error("Zuzahlung ist nicht vollständig bestätigt");
      method = ref(payment.payment_method);
    } else if (s.payment_intent) throw Error("Unerwartete zusätzliche Zahlung");
  }
  if (i.product.kind === "subscription" && !method)
    throw Error("Zahlungsmittel für spätere Abo-Zahlungen fehlt");
  const b = checked<any>(
    await db.rpc("gift_start_billing", { input: { id: i.id } }),
  );
  const update = async (data: Record<string, unknown>) => {
    checked(await db.from("gift_billings").update(data).eq("intent_id", i.id));
    Object.assign(b, data);
  };
  const freshCreate = () => {
    if (Date.now() - Date.parse(b.started_at) > 23 * 3600000)
      throw new HttpError(
        409,
        "Der Rechnungsabschluss benötigt eine Zuordnungsprüfung; es wird keine zweite Rechnung oder Guthabenzahlung angelegt.",
      );
  };
  const cfg = await giftBillingConfig(stripe),
    total = i.expected_amount + i.gift_credit_amount;
  const key = (step: string) => ({
    idempotencyKey: `gift-invoice:${i.id}:${step}`,
  });
  const metadata = {
    product_intent_id: i.id,
    pa_gift_settlement: "de19_single_purpose",
  };
  const adjustments: Stripe.SubscriptionCreateParams.AddInvoiceItem[] = [
    {
      price_data: {
        product: cfg.clearing,
        currency: i.currency,
        unit_amount: -i.gift_credit_amount,
        tax_behavior: "inclusive",
      },
      tax_rates: [cfg.tax],
      metadata: { pa_gift_component: "prepaid_vat_clearing" },
    },
    {
      price_data: {
        product: cfg.value,
        currency: i.currency,
        unit_amount: i.gift_credit_amount,
      },
      tax_rates: [],
      metadata: { pa_gift_component: "prepaid_value" },
    },
  ];
  let subscription: Stripe.Subscription | undefined;
  if (i.product.kind === "subscription") {
    if (!b.subscription_id) {
      freshCreate();
      subscription = await stripe.subscriptions.create(
        {
          customer: i.customer_id,
          collection_method: "send_invoice",
          days_until_due: 1,
          items: [
            {
              price: i.product.price.id,
              quantity: 1,
              tax_rates: [cfg.tax],
              ...(i.discount
                ? { discounts: [{ promotion_code: i.discount.promotion_id }] }
                : {}),
            },
          ],
          add_invoice_items: adjustments,
          default_payment_method: method,
          payment_settings: {
            payment_method_types: ["card"],
            save_default_payment_method: "on_subscription",
          },
          metadata: { ...metadata, pa_gift_pending: "1" },
          expand: ["latest_invoice"],
        },
        key("subscription"),
      );
      await update({
        subscription_id: subscription.id,
        invoice_id: ref(subscription.latest_invoice),
      });
    } else
      subscription = await stripe.subscriptions.retrieve(b.subscription_id, {
        expand: ["latest_invoice"],
      });
  } else if (!b.invoice_id) {
    freshCreate();
    const invoice = await stripe.invoices.create(
      {
        customer: i.customer_id,
        collection_method: "send_invoice",
        days_until_due: 1,
        auto_advance: false,
        pending_invoice_items_behavior: "exclude",
        metadata,
        footer:
          "Geschenkguthaben wird als bereits bezahlter Einzweckgutschein verrechnet. Die bei Erwerb enthaltene Umsatzsteuer wird bei der Einlösung nicht erneut berechnet.",
      },
      key("invoice"),
    );
    await update({ invoice_id: invoice.id });
  }
  let invoice: Stripe.Invoice = await stripe.invoices.retrieve(b.invoice_id);
  if (subscription && invoice.status === "open" && invoice.auto_advance) {
    invoice = await stripe.invoices.update(
      invoice.id!,
      { auto_advance: false },
      key("pause-first-invoice"),
    );
  }
  if (invoice.status === "draft") {
    if (!subscription) {
      freshCreate();
      await stripe.invoiceItems.create(
        {
          customer: i.customer_id,
          invoice: invoice.id,
          pricing: { price: i.product.price.id },
          quantity: 1,
          tax_rates: [cfg.tax],
          ...(i.discount
            ? { discounts: [{ promotion_code: i.discount.promotion_id }] }
            : {}),
          metadata,
        },
        key("service-line"),
      );
      for (let n = 0; n < adjustments.length; n++) {
        const adjustment = adjustments[n],
          rates = adjustment.tax_rates;
        await stripe.invoiceItems.create(
          {
            customer: i.customer_id,
            invoice: invoice.id,
            amount: adjustment.price_data!.unit_amount,
            currency: i.currency,
            description:
              n === 0
                ? "Bereits versteuerter Einzweckgutschein · steuerliche Verrechnung"
                : "Geschenkguthaben · Verrechnungswert ohne erneute Umsatzsteuer",
            tax_rates: Array.isArray(rates) ? rates : [],
            metadata: adjustment.metadata,
            discountable: false,
          },
          key(`clearing-line-${n}`),
        );
      }
    }
    invoice = await stripe.invoices.finalizeInvoice(
      invoice.id!,
      { auto_advance: false },
      key("finalize"),
    );
  }
  if (
    invoice.livemode !== productLiveMode() ||
    ref(invoice.customer) !== i.customer_id ||
    invoice.currency !== i.currency ||
    invoice.total !== total ||
    (subscription &&
      ref(invoice.parent?.subscription_details?.subscription) !==
        subscription.id)
  )
    throw new HttpError(
      409,
      "Rechnungswert, Preisvorteil oder Zuordnung weicht vom bestätigten Kauf ab.",
    );
  if (!b.payment_record_id) {
    freshCreate();
    const time = Math.floor(Date.parse(b.started_at) / 1000);
    const record: any = await stripe.rawRequest(
      "POST",
      "/v1/payment_records/report_payment",
      {
        amount_requested: { currency: i.currency, value: i.gift_credit_amount },
        customer_details: { customer: i.customer_id },
        initiated_at: time,
        outcome: "guaranteed",
        guaranteed: { guaranteed_at: time },
        payment_method_details: {
          type: "custom",
          custom: { display_name: "ProAcademy Geschenkguthaben" },
        },
        processor_details: {
          type: "custom",
          custom: { payment_reference: i.id },
        },
        metadata,
      },
      { ...recordVersion, ...key("gift-payment") },
    );
    if (
      record.livemode !== productLiveMode() ||
      record.amount_guaranteed?.value !== i.gift_credit_amount ||
      record.amount_guaranteed?.currency !== i.currency
    )
      throw Error("Guthabenzahlungsnachweis passt nicht");
    await update({ payment_record_id: record.id });
  }
  if (invoice.status !== "paid") {
    invoice = (await stripe.rawRequest(
      "POST",
      `/v1/invoices/${invoice.id}/attach_payment`,
      { payment_record: b.payment_record_id },
      { ...recordVersion, ...key("attach-gift") },
    )) as unknown as Stripe.Invoice;
    if (payment)
      invoice = await stripe.invoices.attachPayment(
        invoice.id!,
        { payment_intent: payment.id },
        key("attach-cash"),
      );
  }
  if (
    invoice.status !== "paid" ||
    invoice.amount_remaining !== 0 ||
    invoice.amount_paid !== total
  )
    throw Error(
      "Guthaben und Zuzahlung decken die Rechnung noch nicht vollständig",
    );
  const allocated: any[] = [];
  for await (const allocation of stripe.invoicePayments.list({
    invoice: invoice.id!,
    status: "paid",
    limit: 100,
  }))
    allocated.push(allocation);
  if (
    allocated.length !== (payment ? 2 : 1) ||
    allocated.some(
      (p) =>
        p.livemode !== productLiveMode() ||
        p.currency !== i.currency ||
        (p.payment.type === "payment_record"
          ? ref(p.payment.payment_record) !== b.payment_record_id ||
            p.amount_paid !== i.gift_credit_amount
          : p.payment.type !== "payment_intent" ||
            ref(p.payment.payment_intent) !== payment?.id ||
            p.amount_paid !== i.expected_amount),
    ) ||
    !allocated.some((p) => p.payment.type === "payment_record") ||
    (payment && !allocated.some((p) => p.payment.type === "payment_intent")) ||
    invoice.starting_balance ||
    invoice.ending_balance ||
    invoice.pre_payment_credit_notes_amount ||
    invoice.post_payment_credit_notes_amount
  )
    throw Error(
      "Die Rechnung enthält fremde Zahlungen oder eine abweichende Guthabenzuordnung",
    );
  // Check the external record even on retries; an already returned gift must not grant a purchase.
  const record: any = await stripe.rawRequest(
    "GET",
    `/v1/payment_records/${b.payment_record_id}`,
    {},
    recordVersion,
  );
  if (
    record.livemode !== productLiveMode() ||
    record.amount_guaranteed?.value !== i.gift_credit_amount ||
    record.amount_refunded?.value ||
    record.processor_details?.custom?.payment_reference !== i.id
  )
    throw Error("Guthabenzahlung wurde verändert oder zurückgebucht");
  if (subscription) {
    subscription = await stripe.subscriptions.update(
      subscription.id,
      {
        collection_method: "charge_automatically",
        default_payment_method: method,
        metadata: { pa_gift_pending: "" },
      },
      key("future-billing"),
    );
    if (
      subscription.status !== "active" ||
      subscription.items.data.length !== 1 ||
      subscription.items.has_more ||
      subscription.items.data[0].price.id !== i.product.price.id
    )
      throw Error("Abo-Abschluss passt nicht zum Kauf");
  }
  if (payment) await update({ cash_payment_id: payment.id });
  if (payment && i.parent_id)
    checked(
      await db.from("product_payment_links").upsert(
        {
          parent_id: i.parent_id,
          intent_id: i.id,
          subscription_id: subscription?.id ?? null,
          invoice_id: invoice.id,
          payment_intent_id: payment.id,
          amount: i.expected_amount,
          currency: i.currency,
        },
        { onConflict: "payment_intent_id,invoice_id" },
      ),
    );
  await update({ state: "settled" });
  return {
    subscription,
    item: subscription?.items.data[0],
    paymentId: invoice.id!,
    proof: {
      session_id: s.id,
      livemode: s.livemode,
      payment_status: "paid",
      price_id: i.product.price.id,
      product_id: i.product.price.product_id,
      currency: i.currency,
      subtotal: i.expected_subtotal,
      total: i.expected_amount,
      quantity: 1,
      customer_id: i.customer_id,
      payment_id: invoice.id,
      created_at: new Date(s.created * 1000).toISOString(),
      gift_invoice_id: invoice.id,
      gift_payment_record_id: b.payment_record_id,
      gift_credit_amount: i.gift_credit_amount,
      gift_invoice_total: invoice.total,
    },
  };
}

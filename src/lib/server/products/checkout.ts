import { productLiveMode } from "./runtime";
import { recordInvoicePayments } from "./payments";
import { productIdSchema } from "@/lib/products/domain";
import "server-only";
import { guestParentSchema, guestProductContext } from "@/lib/products/guest";
import { resolveDiscount, type CheckoutDiscount } from "./discounts";
import { createHmac } from "node:crypto";
import { z } from "zod";
import Stripe from "stripe";
import type { ProfileSession } from "../parent-profile";
import type { ProductChild } from "@/lib/products/domain";
import { decideProduct } from "@/lib/products/policy";
import { serviceDb } from "../service-db";
import { HttpError } from "../security";
import { syncSubscription } from "../stripe";
import { productById } from "./catalog";
import { checked, collect, loadProductContext } from "./context";
import { productStripe, verifyStoredPrice } from "./stripe";
import { requireProductPayments } from "./runtime";
import { ageAt, currentOffer, maximumSeats } from "@/lib/camps/domain";
import { childBenefit } from "@/lib/camps/service";
const childInput = z
  .object({
    first_name: z.string().trim().min(1).max(80),
    last_name: z.string().trim().min(1).max(80),
    birth_date: z.iso.date(),
    gender: z
      .enum(["weiblich", "männlich", "divers", "keine Angabe"])
      .optional(),
    clothing_size: z.string().max(20).optional(),
  })
  .strict();
const checkoutSchema = z
  .object({
    request_id: productIdSchema,
    guest_parent: guestParentSchema.optional(),
    discount_code: z.string().trim().max(80).optional(),
    player_id: productIdSchema.optional(),
    new_child: childInput.optional(),
    camp_details: z
      .object({
        birth_date: z.iso.date(),
        gender: z.enum(["weiblich", "männlich", "divers", "keine Angabe"]),
        clothing_size: z.string().trim().min(1).max(20),
      })
      .strict()
      .optional(),
    customer_id: z
      .string()
      .regex(/^cus_[A-Za-z0-9_]+$/)
      .optional(),
    channel: z
      .enum(["homepage", "parents", "trials", "catalog"])
      .default("catalog"),
  })
  .strict();
export async function ownIntent(session: ProfileSession, id: string) {
  productIdSchema.parse(id);
  const r = checked(
    await serviceDb()
      .from("product_purchase_intents")
      .select("*")
      .eq("id", id)
      .maybeSingle(),
  );
  if (!r || (session.role !== "admin" && r.auth_id !== session.user.id))
    throw new HttpError(404, "Kaufauftrag nicht gefunden.");
  return r;
}
function reservedChildId(parent: string, value: z.infer<typeof childInput>) {
  const key = `${parent}:${value.first_name.toLowerCase()}:${value.last_name.toLowerCase()}:${value.birth_date}`;
  const h = createHmac("sha256", process.env.SUPABASE_SERVICE_ROLE_KEY!)
    .update(key)
    .digest("hex");
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-4${h.slice(13, 16)}-a${h.slice(17, 20)}-${h.slice(20, 32)}`;
}
export async function checkoutProduct(
  session: ProfileSession | null,
  id: string,
  raw: unknown,
  guestTokenHash?: string,
): Promise<{ id: string; status: string; url?: string }> {
  requireProductPayments();
  if (
    session?.user &&
    (session.role !== "parent" || !session.user.email_confirmed_at)
  )
    throw new HttpError(
      403,
      "Bitte zuerst mit deinem bestätigten Elternkonto anmelden.",
    );
  const input = checkoutSchema.parse(raw);
  const guest = !session?.user;
  if (
    guest &&
    (!input.guest_parent ||
      !input.new_child ||
      !guestTokenHash ||
      input.player_id ||
      input.customer_id)
  )
    throw new HttpError(
      400,
      "Bitte Eltern- und Kinderdaten für die Gastbestellung ergänzen.",
    );
  if (!guest && input.guest_parent)
    throw new HttpError(400, "Bitte dein vorhandenes Elternkonto verwenden.");
  if (!!input.player_id === !!input.new_child)
    throw new HttpError(
      400,
      "Ein eigenes Kind auswählen oder ein neues Kind angeben.",
    );
  const db = serviceDb(),
    stripe = productStripe(),
    p = await productById(id),
    ctx = guest
      ? guestProductContext(input.request_id, input.new_child!)
      : await loadProductContext(session);
  if (!p.published || (!guest && !ctx.parent_id))
    throw new HttpError(
      400,
      "Elternkonto oder veröffentlichtes Produkt fehlt.",
    );
  const previous = checked(
    await db
      .from("product_purchase_intents")
      .select("*")
      .eq("id", input.request_id)
      .maybeSingle(),
  );
  if (previous) {
    if (
      (guest
        ? previous.guest_token_hash !== guestTokenHash ||
          ["full_name", "email", "phone"].some(
            (k) =>
              (previous.guest_data?.[k] ?? "") !==
              ((input.guest_parent as any)?.[k] ?? ""),
          )
        : previous.auth_id !== session!.user.id) ||
      previous.product_id !== id ||
      (input.player_id && previous.player_id !== input.player_id)
    )
      throw new HttpError(409, "Anfragereferenz gehört zu einem anderen Kauf.");
    if (previous.status === "fulfilled")
      return { id: previous.id, status: "fulfilled" };
    if (!["reserved", "checkout"].includes(previous.status))
      throw new HttpError(409, "Dieser Kauf muss zuerst geprüft werden.");
    if (
      input.new_child &&
      ["first_name", "last_name", "birth_date", "gender", "clothing_size"].some(
        (k) =>
          (previous.player_data?.[k] ?? "") !==
          ((input.new_child as any)?.[k] ?? ""),
      )
    )
      throw new HttpError(
        409,
        "Für diese Anfragereferenz wurden andere Kinderdaten gespeichert. Bitte den offenen Kauf zuerst prüfen.",
      );
    if (previous.checkout_url) {
      const { resumeOrder } = await import("./operations");
      if (!guest) return resumeOrder(session!, previous.id);
      const { resumeGuestOrder } = await import("./guest-checkout");
      return resumeGuestOrder(previous.id);
    }
  }
  let playerId = input.player_id;
  if (input.new_child) {
    if (
      Date.parse(input.new_child.birth_date) > Date.now() ||
      Number(input.new_child.birth_date.slice(0, 4)) < 1990
    )
      throw new HttpError(400, "Geburtsdatum prüfen.");
    if (
      !guest &&
      ctx.children.some(
        (c) =>
          c.first_name.toLowerCase() ===
            input.new_child!.first_name.toLowerCase() &&
          c.last_name.toLowerCase() ===
            input.new_child!.last_name.toLowerCase() &&
          (!c.birth_date || c.birth_date === input.new_child!.birth_date),
      )
    )
      throw new HttpError(
        409,
        "Dieses Kind ist bereits vorhanden. Bitte auswählen.",
      );
    playerId = reservedChildId(
      guest ? `guest:${input.guest_parent!.email}` : ctx.parent_id!,
      input.new_child,
    );
    if (guest) ctx.children = [];
    ctx.children.push({
      id: playerId,
      name: `${input.new_child.first_name} ${input.new_child.last_name}`,
      first_name: input.new_child.first_name,
      last_name: input.new_child.last_name,
      birth_date: input.new_child.birth_date,
      memberships: [],
      camp_ids: [],
      purchases: [],
      trial: false,
      former_trial: false,
      reserved: true,
    });
  }
  const openOrders = await collect(() => {
    const query = db
      .from("product_purchase_intents")
      .select("id,product_id,product,guest_data,discount")
      .eq("player_id", playerId!)
      .in("status", ["reserved", "checkout", "failed", "review"]);
    return guest
      ? query.eq("guest_token_hash", guestTokenHash!)
      : query.eq("auth_id", session!.user.id);
  });
  for (const old of openOrders.filter(
    (o) =>
      (o.id !== input.request_id || !previous || !!previous.session_id) &&
      (o.product_id === id ||
        (p.published!.kind === "subscription" &&
          o.product.kind === "subscription")),
  )) {
    const { resumeOrder } = await import("./operations");
    const changedGuestForm =
      guest &&
      (String(old.discount?.code ?? "").toLowerCase() !==
        (input.discount_code ?? "").toLowerCase() ||
        ["full_name", "email", "phone"].some(
          (k) =>
            (old.guest_data?.[k] ?? "") !==
            ((input.guest_parent as any)?.[k] ?? ""),
        ));
    const resumed = guest
      ? await (
          await import("./guest-checkout")
        ).resumeGuestOrder(old.id, changedGuestForm)
      : await resumeOrder(session!, old.id);
    if (resumed.status !== "expired") {
      if (old.product_id !== id)
        throw new HttpError(
          409,
          "Für dieses Kind ist ein anderer Abokauf offen. Bitte unter Meine Buchungen prüfen.",
        );
      return resumed;
    }
  }
  const decision = decideProduct(p.published, id, ctx, input.channel, playerId);
  if (!decision.purchasable || decision.mode === "change")
    throw new HttpError(
      403,
      decision.mode === "change"
        ? "Bitte den bestehenden Tarif wechseln."
        : decision.reasons.join(" ") || "Nicht kaufbar.",
    );
  const price = await verifyStoredPrice(p.published),
    parent = guest
      ? { ...input.guest_parent!, contact_email: input.guest_parent!.email }
      : checked(
          await db
            .from("parents")
            .select("id,full_name,contact_email,phone")
            .eq("id", ctx.parent_id)
            .single(),
        );
  const accounts = guest
    ? []
    : await collect(() =>
        db
          .from("parent_stripe_customers")
          .select("id,stripe_customer_id")
          .eq("parent_id", ctx.parent_id),
      );
  const customers = [...new Set(accounts.map((a) => a.stripe_customer_id))];
  if (
    (input.customer_id && !customers.includes(input.customer_id)) ||
    (customers.length > 1 && !input.customer_id)
  )
    throw new HttpError(400, "Bitte ein eigenes Stripe-Zahlkonto auswählen.");
  let customerId = input.customer_id ?? customers[0];
  if (customerId) {
    const other = checked(
      await db
        .from("parent_stripe_customers")
        .select("id")
        .eq("stripe_customer_id", customerId)
        .neq("parent_id", ctx.parent_id)
        .limit(1),
    );
    if (other.length)
      throw new HttpError(
        409,
        "Zahlkonto ist mehrdeutig zugeordnet. Bitte Verwaltung kontaktieren.",
      );
    const c = await stripe.customers.retrieve(customerId);
    if (c.deleted || c.livemode !== productLiveMode())
      throw new HttpError(400, "Kein gültiges Stripe-Konto.");
  }
  let campDetails: any = null;
  let benefit = 0;
  let promotion: string | undefined;
  let discount: CheckoutDiscount | null = null;
  if (p.published.kind === "camp") {
    const offer = checked(
        await db
          .from("camp_offers")
          .select("*")
          .eq("id", p.published.camp_offer_id!)
          .single(),
      ),
      camp = checked(
        await db.from("camps").select("*").eq("id", offer.camp_id).single(),
      );
    const child = ctx.children.find((c) => c.id === playerId)!;
    const first = [...camp.days].sort((a: any, b: any) =>
      a.starts_at.localeCompare(b.starts_at),
    )[0];
    const birthDate = child.birth_date ?? input.camp_details?.birth_date;
    if (!birthDate || !input.camp_details?.clothing_size)
      throw new HttpError(
        400,
        "Bitte Geburtsdatum, Geschlecht und Kleidergröße für das Camp bestätigen.",
      );
    if (child.birth_date && input.camp_details?.birth_date !== child.birth_date)
      throw new HttpError(
        400,
        "Bitte das gespeicherte Geburtsdatum verwenden.",
      );
    campDetails = {
      ...input.camp_details,
      first_name: child.first_name,
      last_name: child.last_name,
      birth_date: birthDate,
    };
    const age = ageAt(birthDate, first.starts_at);
    if (
      camp.status !== "open" ||
      camp.payment_mode !== (productLiveMode() ? "live" : "test") ||
      Date.parse(first.starts_at) <= Date.now() ||
      age < camp.min_age ||
      age > camp.max_age
    )
      throw new HttpError(409, "Camp ist für dieses Kind nicht verfügbar.");
    if (child.camp_ids.includes(camp.id))
      throw new HttpError(409, "Dieses Kind ist bereits zum Camp angemeldet.");
    const allOffers = checked<any[]>(
      await db.from("camp_offers").select("*").eq("camp_id", camp.id),
    );
    if (currentOffer(allOffers, camp.early_bird_until)?.id !== offer.id)
      throw new HttpError(409, "Das Campangebot ist nicht mehr aktuell.");
    if (!child.reserved) benefit = (await childBenefit(child.id)).percent;
    if (benefit) {
      const code = offer.codes[String(benefit)];
      if (!code) throw new HttpError(400, "Passender Camp-Rabattcode fehlt.");
      const automatic = await resolveDiscount(
        stripe,
        code,
        price,
        customerId,
        false,
        "membership",
      );
      if (
        automatic.amount !==
        price.amount - Math.round((price.amount * benefit) / 100)
      )
        throw new HttpError(400, "Camp-Rabatt ist nicht gültig.");
      discount = automatic;
    }
  }

  if (input.discount_code) {
    const offers = await collect(() =>
      db.from("camp_offers").select("id,codes"),
    );
    if (
      offers.some((o) =>
        Object.values(o.codes ?? {}).some(
          (c) => String(c).toLowerCase() === input.discount_code!.toLowerCase(),
        ),
      )
    )
      throw new HttpError(
        400,
        "Mitgliederrabatte werden für berechtigte Kinder automatisch angewendet. Bitte keinen persönlichen Camp-Code eingeben.",
      );
    const entered = await resolveDiscount(
      stripe,
      input.discount_code,
      price,
      customerId,
      guest,
    );
    if (!discount || entered.amount < discount.amount) {
      discount = entered;
      benefit = 0;
    }
  }
  promotion = discount?.promotion_id;
  const amount = discount?.amount ?? price.amount;
  const reserved = await db.rpc("reserve_product_purchase", {
    input: {
      id: input.request_id,
      product_id: id,
      revision: p.published_revision,
      parent_id: ctx.parent_id,
      auth_id: session?.user.id,
      guest_data: guest ? input.guest_parent : undefined,
      guest_token_hash: guest ? guestTokenHash : undefined,
      discount,
      player_id: playerId,
      player_data: input.new_child,
      customer_id: customerId,
      amount,
      benefit_percent: benefit,
      camp_details: campDetails,
      channel: input.channel,
    },
  });
  if (reserved.error)
    throw new HttpError(
      409,
      "Kauf kann nicht begonnen werden: bereits offen, nicht mehr verfügbar oder Zuordnung geändert.",
    );
  const intent = reserved.data;
  if (!customerId) {
    const c = await stripe.customers.create(
      {
        name: parent.full_name,
        email: parent.contact_email,
        metadata: guest
          ? { product_guest_intent_id: intent.id }
          : { product_parent_id: ctx.parent_id! },
      },
      {
        idempotencyKey: guest
          ? `product-guest:${intent.id}`
          : `product-parent:${ctx.parent_id}`,
      },
    );
    if (c.livemode !== productLiveMode())
      throw new HttpError(
        400,
        "Kunde gehört zu einer anderen Stripe-Umgebung.",
      );
    customerId = c.id;
  }
  checked(
    await db
      .from("product_purchase_intents")
      .update({ customer_id: customerId })
      .eq("id", intent.id)
      .select("id"),
  );
  // Repeat after external validation; a stale card can never initiate a new session.
  const fresh = await productById(id);
  if (
    fresh.published_revision !== p.published_revision ||
    !fresh.published ||
    !decideProduct(fresh.published, id, ctx, input.channel, playerId)
      .purchasable
  )
    throw new HttpError(409, "Angebot wurde während der Prüfung geändert.");
  const origin = new URL(process.env.APP_URL!).origin;
  let checkout: Stripe.Checkout.Session;
  try {
    checkout = await stripe.checkout.sessions.create(
      {
        mode: p.published.kind === "subscription" ? "subscription" : "payment",
        customer: customerId,
        client_reference_id: intent.id,
        metadata: { product_intent_id: intent.id },
        line_items: [{ price: price.id, quantity: 1 }],
        ...(promotion ? { discounts: [{ promotion_code: promotion }] } : {}),
        payment_method_types: ["card"],
        success_url: `${origin}/produkte?purchase=${intent.id}`,
        cancel_url: `${origin}/produkte?purchase=${intent.id}`,
        expires_at: Math.floor(Date.parse(intent.expires_at) / 1000),
        locale: "de",
      },
      { idempotencyKey: `product-checkout:${intent.id}` },
    );
  } catch (error) {
    // A definitive request rejection creates no Checkout. Transport/5xx/unknown
    // errors retain the reservation for remote recovery instead of risking a second charge.
    if (
      error instanceof Stripe.errors.StripeInvalidRequestError &&
      error.code !== "idempotency_key_in_use"
    ) {
      checked(
        await db
          .from("product_purchase_intents")
          .update({
            status: "expired",
            reason: "Stripe hat den Bestellstart abgelehnt",
            updated_at: new Date().toISOString(),
          })
          .eq("id", intent.id)
          .is("session_id", null)
          .select("id"),
      );
      throw new HttpError(
        400,
        "Stripe konnte diesen Bestellstart nicht akzeptieren. Bitte prüfe den Rabattcode und deine Angaben und versuche es erneut.",
      );
    }
    throw error;
  }
  if (
    checkout.livemode !== productLiveMode() ||
    !checkout.url ||
    new URL(checkout.url).hostname !== "checkout.stripe.com"
  )
    throw new HttpError(502, "Ungültige Stripe-Checkout-Antwort.");
  checked(
    await db
      .from("product_purchase_intents")
      .update({
        status: "checkout",
        session_id: checkout.id,
        checkout_url: checkout.url,
        updated_at: new Date().toISOString(),
      })
      .eq("id", intent.id)
      .select("id"),
  );
  const after = await productById(id);
  if (after.published_revision !== p.published_revision) {
    await stripe.checkout.sessions.expire(checkout.id).catch(() => undefined);
    throw new HttpError(409, "Angebot geändert. Checkout wurde angehalten.");
  }
  return { id: intent.id, url: checkout.url, status: "checkout" };
}
export async function fulfillCheckout(id: string) {
  requireProductPayments();
  const db = serviceDb(),
    stripe = productStripe();
  const i = checked(
    await db.from("product_purchase_intents").select("*").eq("id", id).single(),
  );
  if (i.status === "fulfilled" || i.status === "refunded") {
    if (
      i.status === "fulfilled" &&
      i.subscription_id &&
      i.payment_id?.startsWith("in_")
    )
      await recordInvoicePayments(
        await stripe.invoices.retrieve(i.payment_id),
        stripe,
      );
    return { id, status: i.status };
  }
  // A review is resolved explicitly. Replayed Stripe events must not overwrite the
  // identity-review reason required for a later verified guest claim.
  if (i.status === "review") return { id, status: "review" };
  if (!i.session_id) throw new HttpError(409, "Checkout-Referenz fehlt.");
  const session = await stripe.checkout.sessions.retrieve(i.session_id);
  if (
    session.livemode !== productLiveMode() ||
    session.client_reference_id !== id ||
    session.metadata?.product_intent_id !== id ||
    session.mode !==
      (i.product.kind === "subscription" ? "subscription" : "payment")
  )
    throw new HttpError(400, "Checkout gehört nicht zu diesem Kauf.");
  if (session.status === "expired") {
    checked(
      await db
        .from("product_purchase_intents")
        .update({ status: "expired", updated_at: new Date().toISOString() })
        .eq("id", id)
        .neq("status", "fulfilled")
        .select("id"),
    );
    return { id, status: "expired" };
  }
  if (
    !(
      session.payment_status === "paid" ||
      (i.expected_amount === 0 &&
        session.payment_status === "no_payment_required")
    ) ||
    session.status !== "complete"
  )
    return { id, status: "pending_payment" };
  const lines = await stripe.checkout.sessions.listLineItems(session.id, {
    limit: 2,
  });
  const line = lines.data[0];
  const customer =
    typeof session.customer === "string"
      ? session.customer
      : session.customer?.id;
  if (
    lines.has_more ||
    lines.data.length !== 1 ||
    !line.price ||
    line.quantity !== 1 ||
    line.price?.id !== i.product.price.id ||
    (typeof line.price.product === "string"
      ? line.price.product
      : line.price.product.id) !== i.product.price.product_id ||
    session.amount_subtotal !== i.expected_subtotal ||
    session.amount_total !== i.expected_amount ||
    session.currency !== i.currency ||
    customer !== i.customer_id ||
    session.total_details?.amount_shipping ||
    session.total_details?.amount_tax ||
    (i.discount &&
      (session.discounts?.length !== 1 ||
        (typeof session.discounts[0].promotion_code === "string"
          ? session.discounts[0].promotion_code
          : session.discounts[0].promotion_code?.id) !==
          i.discount.promotion_id))
  )
    throw new HttpError(
      400,
      "Preis, Artikel, Betrag oder Zahlkonto passt nicht zum Auftrag.",
    );
  let subscription: Stripe.Subscription | undefined,
    item: Stripe.SubscriptionItem | undefined,
    paymentId: string;
  if (session.mode === "subscription") {
    const sid =
      typeof session.subscription === "string"
        ? session.subscription
        : session.subscription?.id;
    if (!sid) throw new HttpError(400, "Subscription fehlt.");
    subscription = await stripe.subscriptions.retrieve(sid, {
      expand: ["latest_invoice"],
    });
    if (
      subscription.livemode !== productLiveMode() ||
      subscription.status !== "active" ||
      subscription.items.has_more ||
      subscription.items.data.length !== 1 ||
      (typeof subscription.customer === "string"
        ? subscription.customer
        : subscription.customer.id) !== customer
    )
      throw new HttpError(400, "Abonnement ist nicht aktiv oder eindeutig.");
    item = subscription.items.data[0];
    const invoice =
      typeof subscription.latest_invoice === "object"
        ? subscription.latest_invoice
        : null;
    if (
      item.quantity !== 1 ||
      item.price.id !== i.product.price.id ||
      !invoice ||
      invoice.status !== "paid" ||
      invoice.livemode !== productLiveMode() ||
      invoice.amount_paid !== i.expected_amount ||
      invoice.currency !== i.currency ||
      invoice.amount_remaining !== 0
    )
      throw new HttpError(400, "Erstzahlung ist nicht bestätigt.");
    paymentId = invoice.id!;
  } else if (
    i.expected_amount === 0 &&
    ["paid", "no_payment_required"].includes(session.payment_status) &&
    !session.payment_intent &&
    i.discount
  ) {
    paymentId = session.id; // Free Checkout has no PaymentIntent; retain its verified session as the proof.
  } else {
    const piId =
      typeof session.payment_intent === "string"
        ? session.payment_intent
        : session.payment_intent?.id;
    if (!piId) throw new HttpError(400, "Zahlungsnachweis fehlt.");
    const pi = await stripe.paymentIntents.retrieve(piId, {
      expand: ["latest_charge"],
    });
    const charge =
      typeof pi.latest_charge === "object" ? pi.latest_charge : null;
    if (
      pi.livemode !== productLiveMode() ||
      pi.status !== "succeeded" ||
      pi.amount_received !== i.expected_amount ||
      pi.currency !== i.currency ||
      !charge ||
      charge.livemode !== productLiveMode() ||
      !charge.paid ||
      charge.refunded ||
      charge.disputed ||
      charge.amount_refunded > 0 ||
      charge.amount !== i.expected_amount
    )
      throw new HttpError(400, "Zahlung ist nicht vollständig bestätigt.");
    paymentId = piId;
  }
  const proof = {
    session_id: session.id,
    livemode: session.livemode,
    payment_status: session.payment_status,
    price_id: line.price!.id,
    product_id: i.product.price.product_id,
    currency: session.currency,
    subtotal: session.amount_subtotal,
    total: session.amount_total,
    quantity: 1,
    customer_id: customer,
    payment_id: paymentId,
    created_at: new Date(session.created * 1000).toISOString(),
  };
  if (subscription) await syncSubscription(subscription.id, stripe);
  const contextVersion = i.parent_id
    ? checked<string>(
        await db.rpc("product_family_version", { family: i.parent_id }),
      )
    : null;
  // An unclaimed paid family remains a guest until its email is verified.
  let ctx;
  if (i.guest_data && !i.auth_id)
    ctx = guestProductContext(i.player_id, i.player_data);
  else {
    const authResponse = await db.auth.admin.getUserById(i.auth_id);
    if (authResponse.error || !authResponse.data.user?.email_confirmed_at)
      throw new HttpError(409, "Elternanmeldung nicht mehr gültig.");
    const role = checked(
      await db.from("profiles").select("role").eq("id", i.auth_id).single(),
    );
    ctx = await loadProductContext({
      user: authResponse.data.user,
      role: role.role,
    } as ProfileSession);
  }
  if (i.player_data && !ctx.children.some((c) => c.id === i.player_id))
    ctx.children.push({
      id: i.player_id,
      name: `${i.player_data.first_name} ${i.player_data.last_name}`,
      ...i.player_data,
      memberships: [],
      camp_ids: [],
      purchases: [],
      trial: false,
      former_trial: false,
    });
  const p = await productById(i.product_id);
  const allowed =
    p.published &&
    decideProduct(p.published, p.id, ctx, i.channel ?? "catalog", i.player_id)
      .purchasable;
  if (!allowed) {
    checked(
      await db
        .from("product_purchase_intents")
        .update({
          status: "review",
          reason: "Berechtigung während Checkout geändert",
          proof,
          payment_id: paymentId,
          subscription_id: subscription?.id,
          updated_at: new Date().toISOString(),
        })
        .eq("id", id)
        .select("id"),
    );
    if (i.guest_data)
      checked(
        await db
          .from("product_guest_messages")
          .upsert(
            { intent_id: id },
            { onConflict: "intent_id", ignoreDuplicates: true },
          ),
      );
    return { id, status: "review" };
  }

  const r = await db.rpc("fulfill_product_purchase", {
    input: {
      id,
      proof,
      context_version: contextVersion,
      subscription_id: subscription?.id,
      item_id: item?.id,
    },
  });
  if (r.error) {
    checked(
      await db
        .from("product_purchase_intents")
        .update({
          status: "review",
          proof,
          payment_id: paymentId,
          subscription_id: subscription?.id,
          reason: "Zahlung bestätigt; fachliche Zuordnung benötigt Prüfung",
          updated_at: new Date().toISOString(),
        })
        .eq("id", id)
        .neq("status", "fulfilled")
        .select("id"),
    );
    if (i.guest_data)
      checked(
        await db
          .from("product_guest_messages")
          .upsert(
            { intent_id: id },
            { onConflict: "intent_id", ignoreDuplicates: true },
          ),
      );
    return { id, status: "review" };
  }
  if (
    subscription &&
    typeof subscription.latest_invoice === "object" &&
    subscription.latest_invoice
  )
    await recordInvoicePayments(subscription.latest_invoice, stripe);
  return r.data;
}

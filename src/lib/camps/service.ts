import "server-only";
import { randomBytes, randomUUID } from "node:crypto";
import { cookies } from "next/headers";
import { z } from "zod";
import { serviceDb } from "@/lib/server/service-db";
import { sessionUser } from "@/lib/server/supabase";
import { hashToken, HttpError } from "@/lib/server/security";
import {
  ageAt,
  bestBenefit,
  bookingSchema,
  childBookingStatus,
  campSchema,
  currentOffer,
  maximumSeats,
  type Camp,
  type Offer,
} from "./domain";
import {
  campStripe,
  checkoutUrl,
  createCampOffer,
  createCampCheckout,
  verifyOffer,
} from "./stripe";

import { trialCampChildren } from "./trial-children";
import { campReviewEnabled } from "./processing-config";
import { campAppOrigin, campPaymentMode, campLocalEnabled } from "./runtime";

function check<T>(r: {
  data: T;
  error: { message: string } | null;
}): NonNullable<T> {
  if (r.error)
    throw new HttpError(
      503,
      r.error.message.includes("schema cache")
        ? "Camp-Tabellen sind noch nicht eingerichtet."
        : "Camp-Daten konnten nicht verarbeitet werden.",
    );
  return r.data as NonNullable<T>;
}
export async function browserHash(create = false) {
  const store = await cookies();
  let token = store.get("pa_camp_browser")?.value;
  if (!token && create) {
    token = randomBytes(32).toString("hex");
    store.set("pa_camp_browser", token, {
      httpOnly: true,
      sameSite: "lax",
      secure: campAppOrigin().startsWith("https:"),
      path: "/",
      maxAge: 86400 * 7,
    });
  }
  return token ? hashToken(token) : null;
}
export async function campSession(team = false) {
  const s = await sessionUser();
  if (!s?.role) throw new HttpError(401, "Bitte anmelden.");
  if (team && !["staff", "admin"].includes(s.role))
    throw new HttpError(403, "Nur für das Academy-Team.");
  return s;
}
export async function campContext() {
  const s = await sessionUser();
  if (!s?.role) return { role: null, children: [], parent: null };
  if (s.role !== "parent") return { role: s.role, children: [], parent: null };
  const parents = check(
    await serviceDb()
      .from("parents")
      .select("id,full_name,contact_email")
      .eq("auth_user_id", s.user.id)
      .is("archived_at", null),
  );
  if (parents.length !== 1) return { role: s.role, children: [], parent: null };
  const parent = parents[0];
  const links = check(
    await serviceDb()
      .from("parent_players")
      .select(
        "players!inner(id,first_name,last_name,birth_year,camp_birth_date,camp_gender,camp_clothing_size,archived_at)",
      )
      .eq("parent_id", parent.id),
  );
  const ordinaryChildren = links
    .map(
      (x) => x.players as unknown as { id: string; archived_at: string | null },
    )
    .filter((x) => !x.archived_at);
  const trialChildren = await trialCampChildren(parent.id);
  const children = [
    ...new Map(
      [...ordinaryChildren, ...trialChildren].map((c) => [c.id, c]),
    ).values(),
  ];
  return { role: s.role, children, parent };
}
export async function childBenefit(playerId: string) {
  const db = serviceDb();
  const mappings = check(
    await db
      .from("subscription_players")
      .select(
        "subscription_id,stripe_item_id,subscriptions!inner(status,stripe_data)",
      )
      .eq("player_id", playerId),
  );
  const prices: string[] = [];
  let historical = false,
    active = false;
  for (const m of mappings) {
    historical = true;
    const sub = m.subscriptions as unknown as {
      status: string;
      stripe_data: { items?: { id: string; price_id: string }[] };
    };
    if (sub.status !== "active") continue;
    active = true;
    const item = sub.stripe_data.items?.find((i) => i.id === m.stripe_item_id);
    if (item?.price_id) prices.push(item.price_id);
  }
  // Older imports may not contain full item snapshots; use only CURRENT windows of ACTIVE subscriptions.
  const periods = check(
    await db
      .from("entitlement_periods")
      .select("stripe_price_id,subscriptions!inner(status)")
      .eq("player_id", playerId)
      .eq("status", "active")
      .lte("starts_at", new Date().toISOString())
      .gt("ends_at", new Date().toISOString()),
  );
  for (const p of periods)
    if ((p.subscriptions as unknown as { status: string }).status === "active")
      prices.push(p.stripe_price_id);
  const plans = prices.length
    ? check(
        await db
          .from("plans")
          .select("camp_benefit_percent")
          .in("stripe_price_id", prices)
          .or("is_camp.is.null,is_camp.eq.false"),
      )
    : [];
  return {
    percent: bestBenefit(plans.map((p) => p.camp_benefit_percent)),
    group:
      active || prices.length ? "subscriber" : historical ? "former" : "new",
  };
}
export async function getCamp(id: string) {
  const db = serviceDb();
  const camp = check(
    await db.from("camps").select("*").eq("id", id).maybeSingle(),
  ) as Camp | null;
  if (!camp || camp.payment_mode !== campPaymentMode())
    throw new HttpError(404, "Camp nicht gefunden.");
  const offers = check(
    await db.from("camp_offers").select("*").eq("camp_id", id),
  ) as Offer[];
  const occupancy = check(await db.rpc("camp_occupied_seats", { camp_id: id }));
  return { camp, offers, occupied: Number(occupancy) };
}
export async function publicCamp(id: string) {
  const { camp, offers, occupied } = await getCamp(id);
  const s = await sessionUser();
  if (camp.status === "draft" || camp.status === "archived")
    if (!s?.role || s.role === "parent")
      throw new HttpError(404, "Camp ist noch nicht buchbar.");
  const offer = currentOffer(offers, camp.early_bird_until);
  const context = await campContext();
  const bookings = context.children.length
    ? check(
        await serviceDb()
          .from("camp_bookings")
          .select("player_id,status")
          .eq("camp_id", id)
          .in(
            "player_id",
            context.children.map((c) => c.id),
          )
          .in("status", ["paid", "review"]),
      )
    : [];
  return {
    camp,
    occupied,
    maximum: maximumSeats(camp),
    offer: offer
      ? {
          kind: offer.kind,
          amount: offer.amount,
          currency: offer.currency,
          automatic_benefit: !offer.stripe_payment_link_id,
        }
      : null,
    context: {
      ...context,
      children: context.children.map((child) => ({
        ...child,
        booking_status: childBookingStatus(bookings, child.id),
      })),
    },
  };
}
export async function discount(campId: string, playerId: string) {
  const context = await campContext();
  if (!context.children.some((p) => p.id === playerId))
    throw new HttpError(403, "Kind gehört nicht zu diesem Elternkonto.");
  const { camp, offers } = await getCamp(campId);
  const bookingStatus = await existingChildBooking(campId, playerId);
  if (bookingStatus)
    return { percent: 0, code: null, booking_status: bookingStatus };
  const { percent } = await childBenefit(playerId);
  const offer = currentOffer(offers, camp.early_bird_until);
  return {
    percent,
    code: percent ? (offer?.codes[String(percent)] ?? null) : null,
    automatic: !offer?.stripe_payment_link_id,
    booking_status: null,
  };
}
async function existingChildBooking(campId: string, playerId: string) {
  const bookings = check(
    await serviceDb()
      .from("camp_bookings")
      .select("player_id,status")
      .eq("camp_id", campId)
      .eq("player_id", playerId)
      .in("status", ["paid", "review"]),
  );
  return childBookingStatus(bookings, playerId);
}
export async function requireCampPayments() {
  if (campPaymentMode() !== "live") return;
  const installation = check(
    await serviceDb()
      .from("camp_installation")
      .select("live_payments_enabled")
      .single(),
  );
  if (
    !installation.live_payments_enabled ||
    process.env.CAMP_LIVE_PAYMENTS_ENABLED !== "true"
  )
    throw new HttpError(
      503,
      "Die Camp-Anmeldung wird vorbereitet. Zahlungen sind noch nicht freigegeben.",
    );
}
export async function createBooking(input: unknown) {
  await requireCampPayments();
  const body = bookingSchema.parse(input),
    db = serviceDb();
  const { camp, offers, occupied } = await getCamp(body.camp_id);
  if (camp.status !== "open" || occupied >= maximumSeats(camp))
    throw new HttpError(409, "Die Anmeldung ist geschlossen.");
  const first = [...camp.days].sort((a, b) =>
    a.starts_at.localeCompare(b.starts_at),
  )[0];
  if (Date.parse(first.starts_at) <= Date.now())
    throw new HttpError(409, "Dieses Camp hat bereits begonnen.");
  const age = ageAt(body.child.birth_date, first.starts_at);
  if (
    age < camp.min_age ||
    age > camp.max_age ||
    Date.parse(body.child.birth_date) > Date.now()
  )
    throw new HttpError(
      400,
      `Das Camp ist für Kinder von ${camp.min_age} bis ${camp.max_age} Jahren.`,
    );
  const offer = currentOffer(offers, camp.early_bird_until);
  if (!offer)
    throw new HttpError(409, "Kein gültiges Zahlungsangebot hinterlegt.");
  const context = await campContext();
  let parentId: string | null = null,
    playerId: string | null = null,
    benefit = { percent: 0, group: "new" };
  if (body.player_id) {
    if (
      !context.parent ||
      !context.children.some((p) => p.id === body.player_id)
    )
      throw new HttpError(403, "Kind gehört nicht zu diesem Elternkonto.");
    parentId = context.parent.id;
    playerId = body.player_id;
    const existing = await existingChildBooking(camp.id, playerId);
    if (existing)
      throw new HttpError(
        409,
        existing === "paid"
          ? "Dieses Kind ist bereits angemeldet und bestätigt."
          : "Die Buchung für dieses Kind wird bereits geprüft. Bitte nicht erneut buchen.",
      );
    benefit = await childBenefit(playerId);
    body.parent.name = context.parent.full_name;
    body.parent.email = context.parent.contact_email;
    const child = context.children.find(
      (p) => p.id === playerId,
    ) as unknown as {
      first_name: string;
      last_name: string;
      camp_birth_date?: string;
      birth_year?: number;
    };
    body.child.first_name = child.first_name;
    body.child.last_name = child.last_name;
    if (
      child.camp_birth_date
        ? child.camp_birth_date !== body.child.birth_date
        : child.birth_year &&
          child.birth_year !== Number(body.child.birth_date.slice(0, 4))
    )
      throw new HttpError(
        400,
        child.camp_birth_date
          ? "Bitte das gespeicherte Geburtsdatum verwenden."
          : `Geburtsjahr ${child.birth_year} ist bereits gespeichert. Bitte nur Tag und Monat ergänzen.`,
      );
  } else if (context.role === "parent")
    throw new HttpError(400, "Bitte ein zugeordnetes Kind auswählen.");
  const hash = await browserHash(true);
  if (!parentId) {
    const previous = check(
      await db
        .from("camp_bookings")
        .select("parent_id,parent_data")
        .eq("browser_token_hash", hash!)
        .eq("status", "paid")
        .order("created_at", { ascending: false }),
    );
    const family = previous.find(
      (b) =>
        b.parent_data.email.toLowerCase() === body.parent.email.toLowerCase() &&
        b.parent_data.name.trim().toLowerCase() ===
          body.parent.name.trim().toLowerCase(),
    );
    if (family) {
      const owned = check(
        await db
          .from("camp_owned_rows")
          .select("record_id")
          .eq("table_name", "parents")
          .eq("record_id", family.parent_id),
      );
      if (owned.length) parentId = family.parent_id;
    }
    if (!parentId) {
      const existing = check(
        await db
          .from("parents")
          .select("id")
          .ilike("contact_email", body.parent.email.replace(/[%_]/g, "\\$&"))
          .is("archived_at", null),
      );
      if (existing.length)
        throw new HttpError(
          409,
          "Bitte über den bestehenden Kundenzugang anmelden oder die Academy kontaktieren.",
        );
    }
  }
  const bookingCodes: Record<string, string> = {};
  if (benefit.percent > 0) {
    const code = offer.codes[String(benefit.percent)];
    if (!code)
      throw new HttpError(
        400,
        `Für deinen Abo-Rabatt von ${benefit.percent} % ist kein Rabattcode hinterlegt. Bitte kontaktiere die Academy.`,
      );
    bookingCodes[String(benefit.percent)] = code;
  }
  if (offer.stripe_payment_link_id)
    await verifyOffer(
      offer.stripe_price_id,
      offer.stripe_payment_link_id,
      bookingCodes,
    );
  const id = randomUUID();
  check(
    await db.from("camp_bookings").insert({
      id,
      camp_id: camp.id,
      offer_id: offer.id,
      parent_id: parentId,
      player_id: playerId,
      browser_token_hash: hash,
      parent_data: body.parent,
      child_data: body.child,
      customer_group: benefit.group,
      benefit_percent: benefit.percent,
      expected_amount: offer.amount,
      currency: offer.currency,
      stripe_price_id: offer.stripe_price_id,
      stripe_payment_link_id: offer.stripe_payment_link_id,
      booking_origin: offer.stripe_payment_link_id
        ? "checkout"
        : "portal_checkout",
    }),
  );
  if (!offer.stripe_payment_link_id) {
    const session = await createCampCheckout(
      offer,
      id,
      body.parent.email,
      benefit.percent,
      campAppOrigin(),
    );
    check(
      await db
        .from("camp_bookings")
        .update({ checkout_session_id: session.id })
        .eq("id", id),
    );
    return { id, url: session.url };
  }
  return { id, url: checkoutUrl(offer, id, body.parent.email) };
}
export async function confirmPayment(sessionId: string, asAdmin = false) {
  await requireCampPayments();
  const live = campPaymentMode() === "live";
  if (
    !(live ? /^cs_live_[A-Za-z0-9_]+$/ : /^cs_test_[A-Za-z0-9_]+$/).test(
      sessionId,
    )
  )
    throw new HttpError(400, "Zahlungsreferenz passt nicht zum Zahlungsmodus.");
  const stripe = campStripe(),
    db = serviceDb();
  const s = await stripe.checkout.sessions.retrieve(sessionId);
  if (s.livemode !== live || s.mode !== "payment" || !s.client_reference_id)
    throw new HttpError(400, "Keine zuordenbare Camp-Zahlung.");
  const b = check(
    await db
      .from("camp_bookings")
      .select("*")
      .eq("id", z.uuid().parse(s.client_reference_id))
      .maybeSingle(),
  );
  if (!b)
    throw new HttpError(
      404,
      "Buchung nicht gefunden. Bitte Academy kontaktieren.",
    );
  await getCamp(b.camp_id);
  if (
    b.booking_origin === "portal_checkout" &&
    (b.checkout_session_id !== s.id ||
      s.metadata?.camp_booking_id !== b.id ||
      s.metadata?.camp_id !== b.camp_id ||
      s.metadata?.camp_offer_id !== b.offer_id ||
      s.payment_link)
  )
    throw new HttpError(400, "Checkout gehört nicht zu dieser Camp-Buchung.");
  if (!asAdmin && b.browser_token_hash !== (await browserHash()))
    throw new HttpError(403, "Zahlung gehört nicht zu diesem Buchungsablauf.");
  if (b.status === "cancelled")
    return { status: "cancelled", booking_id: b.id, camp_id: b.camp_id };
  if (
    s.payment_status !== "paid" &&
    !(
      s.payment_status === "no_payment_required" &&
      s.status === "complete" &&
      s.amount_total === 0 &&
      !s.payment_intent &&
      s.total_details?.amount_discount === b.expected_amount
    )
  )
    return { status: "pending", booking_id: b.id, camp_id: b.camp_id };
  const lines = await stripe.checkout.sessions.listLineItems(s.id, {
    limit: 10,
  });
  if (lines.has_more || lines.data.length !== 1)
    throw new HttpError(400, "Zahlung enthält nicht genau einen Artikel.");
  const line = lines.data[0],
    off = s.total_details?.amount_discount ?? 0;
  const allowed = [0, 10, 15, 20]
    .filter((n) => n <= b.benefit_percent)
    .some(
      (n) => Math.abs(off - Math.round((b.expected_amount * n) / 100)) <= 1,
    );
  let reviewReason = !allowed
    ? "Verwendeter Rabatt passt nicht zum Abo-Anrecht"
    : s.amount_total !== b.expected_amount - off ||
        s.total_details?.amount_shipping
      ? "Zahlungsbetrag weicht vom Camp-Angebot ab"
      : null;
  const paymentId =
    typeof s.payment_intent === "string"
      ? s.payment_intent
      : s.payment_intent?.id;
  // Stripe creates no PaymentIntent for a completed, fully discounted order.
  // Keep the Checkout Session as its unique accounting reference, never invent a pi_ ID.
  const noCost =
    !paymentId &&
    s.status === "complete" &&
    s.amount_total === 0 &&
    off === b.expected_amount;
  const paymentLink =
    typeof s.payment_link === "string"
      ? s.payment_link
      : (s.payment_link?.id ?? null);
  if (
    line.price?.id !== b.stripe_price_id ||
    paymentLink !== b.stripe_payment_link_id ||
    line.quantity !== 1 ||
    s.currency !== b.currency ||
    s.amount_subtotal !== b.expected_amount ||
    (!paymentId && !noCost)
  )
    throw new HttpError(400, "Zahlung passt nicht zu dieser Camp-Buchung.");
  const pi = paymentId
    ? await stripe.paymentIntents.retrieve(paymentId, {
        expand: ["latest_charge"],
      })
    : null;
  const charge =
    pi && typeof pi.latest_charge === "object" ? pi.latest_charge : null;
  if (
    !noCost &&
    (!charge ||
      !pi ||
      pi.livemode !== live ||
      charge.livemode !== live ||
      pi.status !== "succeeded" ||
      !charge.paid ||
      pi.currency !== b.currency ||
      charge.currency !== b.currency ||
      pi.amount_received !== s.amount_total ||
      charge.amount !== s.amount_total ||
      (typeof charge.payment_intent === "string"
        ? charge.payment_intent
        : charge.payment_intent?.id) !== paymentId)
  )
    throw new HttpError(
      400,
      "Zahlungsnachweis ist nicht vollständig bestätigt.",
    );
  const refunded = !!charge?.refunded;
  if (!refunded && charge && (charge.disputed || charge.amount_refunded > 0)) {
    reviewReason = charge.disputed
      ? "Zahlung angefochten; manuell prüfen"
      : "Teilweise Erstattung; manuell prüfen";
    if (b.stripe_session_id === s.id && ["paid", "review"].includes(b.status)) {
      check(
        await db
          .from("camp_bookings")
          .update({ review_reason: reviewReason })
          .eq("id", b.id),
      );
      return { status: "review", booking_id: b.id, camp_id: b.camp_id };
    }
  }
  if (refunded && ["paid", "review", "refunded"].includes(b.status)) {
    check(
      await db
        .from("camp_bookings")
        .update({
          status: "refunded",
          review_reason: "Vollständige Erstattung in Stripe bestätigt",
        })
        .eq("id", b.id),
    );
    return { status: "refunded", booking_id: b.id, camp_id: b.camp_id };
  }
  const result = check(
    await db.rpc("camp_confirm_payment", {
      input: {
        booking_id: b.id,
        session_id: s.id,
        livemode: s.livemode,
        payment_status: s.payment_status,
        price_id: line.price?.id,
        payment_link_id: paymentLink,
        payment_id: paymentId ?? s.id,
        proof_kind: noCost ? "no_cost_checkout" : "payment_intent",
        customer_id:
          typeof s.customer === "string" ? s.customer : s.customer?.id,
        quantity: line.quantity,
        subtotal: s.amount_subtotal,
        total: s.amount_total,
        currency: s.currency,
        review_reason: reviewReason,
        refunded,
      },
    }),
  );
  const customerId =
    typeof s.customer === "string" ? s.customer : s.customer?.id;
  if (customerId && !live) {
    const owned = check(
      await db
        .from("camp_stripe_assets")
        .select("id")
        .eq("id", b.stripe_payment_link_id ?? b.stripe_price_id)
        .eq("kind", b.stripe_payment_link_id ? "payment_link" : "price"),
    );
    if (owned.length)
      check(
        await db
          .from("camp_stripe_assets")
          .upsert({ id: customerId, kind: "customer", camp_id: b.camp_id }),
      );
  }
  return { ...result, camp_id: b.camp_id, no_cost: noCost };
}
export async function removeCampMember(input: unknown) {
  const session = await campSession(true);
  if (session.role !== "admin")
    throw new HttpError(403, "Nur Admins dürfen Camp-Teilnahmen entfernen.");
  const { booking_id } = z.object({ booking_id: z.uuid() }).parse(input);
  const db = serviceDb();
  const booking = check(
    await db
      .from("camp_bookings")
      .select("camp_id,status")
      .eq("id", booking_id)
      .maybeSingle(),
  );
  if (!booking) throw new HttpError(404, "Camp-Buchung nicht gefunden.");
  await getCamp(booking.camp_id);
  if (!["paid", "review", "refunded", "cancelled"].includes(booking.status))
    throw new HttpError(400, "Die Buchung ist noch nicht abgeschlossen.");
  check(
    await db.rpc("camp_remove_member", {
      booking_id,
      actor_id: session.user.id,
    }),
  );
  return {
    ok: true,
    message: "Teilnahme entfernt. Es wurde keine Erstattung ausgelöst.",
  };
}
export async function invitationWish(id: string) {
  const db = serviceDb();
  const b = check(
    await db
      .from("camp_bookings")
      .select("id,status,browser_token_hash")
      .eq("id", id)
      .maybeSingle(),
  );
  if (
    !b ||
    b.browser_token_hash !== (await browserHash()) ||
    b.status !== "paid"
  )
    throw new HttpError(403, "Bestätigte eigene Buchung erforderlich.");
  check(
    await db
      .from("camp_bookings")
      .update({ invitation_requested_at: new Date().toISOString() })
      .eq("id", id),
  );
  return {
    message:
      "Deine Anfrage ist gespeichert. Dein Portalzugang ist noch nicht aktiviert.",
  };
}
export async function dashboard() {
  const session = await campSession(),
    db = serviceDb();
  const camps = check(
    await db
      .from("camps")
      .select("*")
      .eq("payment_mode", campPaymentMode())
      .order("created_at", { ascending: false }),
  ) as Camp[];
  if (session.role !== "parent") {
    const [bookings, offers, plans, reports, locations] = await Promise.all([
      db
        .from("camp_bookings")
        .select(
          "id,camp_id,player_id,parent_id,parent_data,child_data,customer_group,status,attendance_status,attendance_confirmed_at,paid_amount,paid_at,review_reason,invitation_requested_at,stripe_session_id",
        )
        .in("status", ["paid", "review", "cancelled", "refunded"])
        .order("created_at", { ascending: false }),
      db.from("camp_offers").select("*"),
      db
        .from("plans")
        .select("id,name,generation,billing_interval,camp_benefit_percent")
        .or("is_camp.is.null,is_camp.eq.false"),
      db.from("camp_reports").select("*"),
      db
        .from("locations")
        .select("id,name,address")
        .eq("active", true)
        .order("name"),
    ]);
    return {
      role: session.role,
      local_stripe_review: campReviewEnabled(),
      camps: await Promise.all(
        camps.map(async (c) => ({
          ...c,
          occupied: Number(
            check(await db.rpc("camp_occupied_seats", { camp_id: c.id })),
          ),
        })),
      ),
      bookings:
        session.role === "admin"
          ? check(bookings)
          : check(bookings).map(
              ({
                paid_amount,
                paid_at,
                stripe_session_id,
                review_reason,
                ...booking
              }) => booking,
            ),
      offers: check(offers),
      plans: check(plans),
      reports: check(reports),
      children: [],
      locations: check(locations),
    };
  }
  const context = await campContext();
  const bookings = context.parent
    ? check(
        await db
          .from("camp_bookings")
          .select("id,camp_id,player_id,child_data,status,paid_at,paid_amount")
          .in(
            "player_id",
            context.children.length
              ? context.children.map((c) => c.id)
              : ["00000000-0000-0000-0000-000000000000"],
          )
          .in("status", ["paid", "review", "cancelled", "refunded"]),
      )
    : [];
  const ids = bookings.map((b) => b.id);
  const reports = ids.length
    ? check(
        await db
          .from("camp_reports")
          .select("booking_id,content,updated_at")
          .in("booking_id", ids)
          .eq("visible_to_parent", true),
      )
    : [];
  const children = await Promise.all(
    context.children.map(async (c) => ({
      ...c,
      ...(await childBenefit(c.id)),
    })),
  );
  const visibleCamps = camps.filter(
    (c) =>
      c.status === "open" ||
      (ids.length && bookings.some((b) => b.camp_id === c.id)),
  );
  const publicOffers = visibleCamps.length
    ? check(
        await db
          .from("camp_offers")
          .select("camp_id,kind,amount,currency")
          .in(
            "camp_id",
            visibleCamps.map((c) => c.id),
          ),
      )
    : [];
  return {
    role: session.role,
    camps: visibleCamps,
    offers: publicOffers,
    bookings,
    reports,
    children,
    plans: [],
    locations: [],
  };
}
export async function saveCamp(input: unknown, appUrl: string) {
  await campSession(true);
  await requireCampPayments();
  const extra = z
    .object({
      location_id: z.uuid(),
      main_amount: z.number().int().min(50).max(1000000).optional(),
      early_amount: z.number().int().min(50).max(1000000).optional(),
    })
    .parse(input);
  const db = serviceDb();
  const location = check(
    await db
      .from("locations")
      .select("name,address")
      .eq("id", extra.location_id)
      .eq("active", true)
      .maybeSingle(),
  );
  if (!location)
    throw new HttpError(400, "Bitte einen aktiven Standort auswählen.");
  const data = campSchema.parse({
    ...(input as Record<string, unknown>),
    location: [location.name, location.address].filter(Boolean).join(" · "),
  });
  if (extra.early_amount !== undefined && !data.early_bird_until)
    throw new HttpError(400, "Bitte das Ende des Frühbucherangebots angeben.");
  if (
    extra.main_amount !== undefined &&
    extra.early_amount !== undefined &&
    extra.early_amount > extra.main_amount
  )
    throw new HttpError(
      400,
      "Der Frühbucherpreis darf nicht höher als der Normalpreis sein.",
    );
  const { main, early, id, ...fields } = data;
  const campId = id ?? randomUUID();
  if (
    id &&
    check(await db.from("camps").select("id").eq("id", id).maybeSingle())
  ) {
    const old = await getCamp(id);
    for (const kind of ["main", "early"] as const) {
      const existing = old.offers.find((o) => o.kind === kind);
      const amount = kind === "main" ? extra.main_amount : extra.early_amount;
      if (existing && amount !== undefined && existing.amount !== amount)
        throw new HttpError(
          400,
          "Bestehende Preise bleiben für Buchungen unverändert. Neues Camp anlegen oder Angebot separat prüfen.",
        );
    }
  }
  check(
    await db.from("camps").upsert({
      ...fields,
      id: campId,
      payment_mode: campPaymentMode(),
      status: "draft",
    }),
  );
  let sharedProductId: string | undefined = check(
    await db
      .from("camp_offers")
      .select("stripe_product_id")
      .eq("camp_id", campId),
  )[0]?.stripe_product_id;
  for (const kind of ["main", "early"] as const) {
    const supplied = kind === "main" ? main : early,
      amount = kind === "main" ? extra.main_amount : extra.early_amount;
    const existing = check(
      await db
        .from("camp_offers")
        .select("id")
        .eq("camp_id", campId)
        .eq("kind", kind),
    );
    if (existing.length) continue;
    if (!supplied && !amount) continue;
    const offer = supplied
      ? await verifyOffer(
          supplied.price_id,
          supplied.payment_link_id,
          supplied.codes,
        )
      : await createCampOffer(
          campId,
          fields.title,
          kind,
          amount!,
          appUrl,
          sharedProductId,
        );
    sharedProductId ??= offer.stripe_product_id;
    check(
      await db.rpc("camp_save_offer", {
        input: { ...offer, camp_id: campId, kind },
      }),
    );
  }
  const { offers } = await getCamp(campId);
  if (
    fields.status === "open" &&
    (!offers.some((o) => o.kind === "main") ||
      (fields.early_bird_until && !offers.some((o) => o.kind === "early")))
  )
    throw new HttpError(
      400,
      "Camp vorbereitet. Hinterlege einen Preis, bevor du die Anmeldung öffnest.",
    );
  check(
    await db.from("camps").update({ status: fields.status }).eq("id", campId),
  );
  return { id: campId, url: `${appUrl}/camp/buchung/${campId}` };
}
export async function reconcileCamp(id: string) {
  await campSession(true);
  const { offers } = await getCamp(id),
    stripe = campStripe();
  let checked = 0;
  const errors: string[] = [];
  for (const offer of offers.filter((o) => o.stripe_payment_link_id)) {
    for await (const s of stripe.checkout.sessions.list({
      payment_link: offer.stripe_payment_link_id!,
      limit: 100,
    })) {
      if (s.payment_status !== "paid") continue;
      try {
        await confirmPayment(s.id, true);
        checked++;
      } catch (e) {
        errors.push(
          `${s.id}: ${e instanceof Error ? e.message : "Prüfung fehlgeschlagen"}`,
        );
      }
    }
  }
  const portalBookings = check(
    await serviceDb()
      .from("camp_bookings")
      .select("checkout_session_id")
      .eq("camp_id", id)
      .eq("booking_origin", "portal_checkout"),
  );
  for (const booking of portalBookings) {
    if (!booking.checkout_session_id) continue;
    try {
      await confirmPayment(booking.checkout_session_id, true);
      checked++;
    } catch (e) {
      errors.push(
        e instanceof Error
          ? e.message
          : "Checkout konnte nicht geprüft werden.",
      );
    }
  }
  return { checked, errors };
}

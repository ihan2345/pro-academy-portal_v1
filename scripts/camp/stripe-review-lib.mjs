const objectId = (value) => (typeof value === "string" ? value : value?.id);

// Read-only adapter: no Stripe mutations, Supabase client, mail or portal jobs.
export async function collectCampReview(stripe, links) {
  const records = new Map();
  let sessionCount = 0;
  for (const source of links) {
    const link = await stripe.paymentLinks.retrieve(source.payment_link_id);
    if (!link.livemode || link.id !== source.payment_link_id)
      throw new Error("Wrong source mode or payment link");
    let after;
    for (let page = 0; ; page++) {
      if (page >= 100) throw new Error("Source pagination limit exceeded");
      const batch = await stripe.checkout.sessions.list({
        payment_link: source.payment_link_id,
        limit: 100,
        ...(after ? { starting_after: after } : {}),
      });
      for (const session of batch.data) {
        sessionCount++;
        if (session.payment_status !== "paid") continue;
        if (
          !session.livemode ||
          session.mode !== "payment" ||
          objectId(session.payment_link) !== source.payment_link_id
        )
          throw new Error("Session does not belong to approved source");
        const intentId = objectId(session.payment_intent);
        const noCost =
          !intentId &&
          session.status === "complete" &&
          session.amount_total === 0 &&
          Number.isInteger(session.amount_subtotal) &&
          session.amount_subtotal > 0 &&
          session.total_details?.amount_discount === session.amount_subtotal;
        // A completed 100%-discounted Checkout has no payment or charge.
        const paymentId = intentId ?? (noCost ? session.id : null);
        if (!paymentId)
          throw new Error("Paid session without payment reference");
        const [lines, payment] = await Promise.all([
          stripe.checkout.sessions.listLineItems(session.id, { limit: 100 }),
          intentId
            ? stripe.paymentIntents.retrieve(intentId)
            : Promise.resolve(null),
        ]);
        const chargeId = objectId(payment?.latest_charge);
        if (!chargeId && !noCost)
          throw new Error("Paid session without charge");
        const charge = chargeId
          ? await stripe.charges.retrieve(chargeId)
          : null;
        if (
          !noCost &&
          (!payment?.livemode ||
            !charge?.livemode ||
            objectId(charge.payment_intent) !== paymentId)
        )
          throw new Error("Payment identity mismatch");
        const issues = noCost
          ? ["Kostenloser Checkout; Sonderrabatt manuell prüfen"]
          : [];
        if (
          lines.has_more ||
          lines.data.length !== 1 ||
          lines.data[0]?.quantity !== 1 ||
          lines.data[0]?.price?.id !== source.price_id ||
          objectId(lines.data[0]?.price?.product) !== source.product_id
        )
          issues.push("Artikel oder Menge bitte prüfen");
        if (
          session.currency !== "eur" ||
          (!noCost &&
            (payment.currency !== "eur" ||
              charge.currency !== "eur" ||
              payment.status !== "succeeded" ||
              !charge.paid ||
              !Number.isInteger(session.amount_total) ||
              session.amount_total <= 0 ||
              payment.amount_received !== session.amount_total ||
              charge.amount !== session.amount_total))
        )
          issues.push("Zahlungsbetrag oder Zahlungsstatus bitte prüfen");
        if (charge?.disputed) issues.push("Zahlung angefochten");
        if (charge?.amount_refunded && !charge.refunded)
          issues.push("Teilweise Erstattung bitte prüfen");
        const field = (label) => {
          const f = session.custom_fields?.find(
            (f) => f.label?.custom === label,
          );
          return String(
            f?.text?.value ?? f?.numeric?.value ?? f?.dropdown?.value ?? "",
          );
        };
        const childName = field("Name des Kindes");
        if (!childName) issues.push("Kindesname fehlt");
        const row = {
          camp_id: source.camp_id,
          payment_link_id: source.payment_link_id,
          session_id: session.id,
          payment_id: paymentId,
          booking_reference: session.client_reference_id ?? null,
          parent_name: session.customer_details?.name ?? "",
          child_name: childName,
          age_at_booking: field("Alter des Kindes"),
          clothing_size: field("Kleidergröße des Kindes"),
          amount: session.amount_total,
          currency: session.currency,
          status: charge?.refunded
            ? "refunded"
            : issues.length
              ? "review"
              : "paid",
          issues,
          created_at: new Date(session.created * 1000).toISOString(),
        };
        const previous = records.get(paymentId);
        if (previous && previous.session_id !== session.id)
          throw new Error("Payment referenced by multiple sessions");
        records.set(paymentId, row);
      }
      if (!batch.has_more) break;
      const next = batch.data.at(-1)?.id;
      if (!next || next === after) throw new Error("Invalid pagination cursor");
      after = next;
    }
  }
  return { session_count: sessionCount, records: [...records.values()] };
}

import "server-only";
import { z } from "zod";
import type Stripe from "stripe";
import type { ProfileSession } from "./parent-profile";
import type { StripeParentInputs } from "../stripe-parent-inputs";
import { assertRole, HttpError } from "./security";
import { profileStripeClient } from "./profile-stripe";

const query = z
  .object({
    customer: z
      .string()
      .regex(/^cus_[A-Za-z0-9]+$/)
      .max(255),
    subscription: z
      .string()
      .regex(/^sub_[A-Za-z0-9]+$/)
      .max(255)
      .optional(),
  })
  .strict();
const objectId = (value: string | { id: string } | null) =>
  typeof value === "string" ? value : (value?.id ?? null);

export async function stripeParentInputs(
  session: ProfileSession,
  input: unknown,
): Promise<StripeParentInputs> {
  assertRole(session.role, "admin");
  const params = query.parse(input);
  const result: StripeParentInputs = { entries: [], partial: false };
  const seen = new Set<string>();
  let after: string | undefined;
  try {
    const stripe = profileStripeClient();
    for (let page = 0; page < 10; page++) {
      const response: Stripe.ApiList<Stripe.Checkout.Session> =
        await stripe.checkout.sessions.list(
          {
            customer: params.customer,
            ...(params.subscription
              ? { subscription: params.subscription }
              : {}),
            limit: 100,
            ...(after ? { starting_after: after } : {}),
          },
          { timeout: 6000, maxNetworkRetries: 0 },
        );
      for (const checkout of response.data) {
        if (seen.has(checkout.id)) continue;
        seen.add(checkout.id);
        if (
          checkout.status !== "complete" ||
          objectId(checkout.customer) !== params.customer ||
          (params.subscription &&
            objectId(checkout.subscription) !== params.subscription) ||
          !checkout.custom_fields?.length
        )
          continue;
        result.entries.push({
          sessionId: checkout.id,
          subscriptionId: objectId(checkout.subscription),
          submittedAt: new Date(checkout.created * 1000).toISOString(),
          fields: checkout.custom_fields.map((field) => {
            let value: string | null = null;
            if (field.type === "text") value = field.text?.value ?? null;
            if (field.type === "numeric") value = field.numeric?.value ?? null;
            if (field.type === "dropdown") {
              const selected = field.dropdown?.value;
              value =
                field.dropdown?.options.find(
                  (option) => option.value === selected,
                )?.label ??
                selected ??
                null;
            }
            return {
              key: field.key,
              label: field.label.custom || field.key,
              value,
            };
          }),
        });
      }
      if (!response.has_more) return result;
      const next = response.data.at(-1)?.id;
      if (!next || next === after) {
        result.partial = true;
        return result;
      }
      after = next;
    }
    result.partial = true;
    return result;
  } catch {
    if (result.entries.length) return { ...result, partial: true };
    throw new HttpError(
      503,
      "Die Elternangaben aus Stripe konnten nicht geladen werden. Bitte erneut versuchen.",
    );
  }
}

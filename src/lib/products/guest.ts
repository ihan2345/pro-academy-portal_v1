import { z } from "zod";
import { visitorContext, type ProductContext } from "./domain";
export const guestParentSchema = z
  .object({
    full_name: z.string().trim().min(2).max(160),
    email: z.email().trim().toLowerCase().max(254),
    phone: z.string().trim().max(40).optional(),
  })
  .strict();
export function guestProductContext(
  playerId: string,
  child: { first_name: string; last_name: string; birth_date: string },
): ProductContext {
  return {
    ...visitorContext(),
    children: [
      {
        id: playerId,
        ...child,
        name: `${child.first_name} ${child.last_name}`,
        trial: false,
        former_trial: false,
        memberships: [],
        camp_ids: [],
        purchases: [],
        reserved: true,
      },
    ],
  };
}

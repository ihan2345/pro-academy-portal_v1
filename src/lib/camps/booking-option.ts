import { z } from "zod";

export const bookingOptionSchema = z
  .object({
    amount: z.number().int().min(50).max(10000000),
    title: z.string().trim().min(2).max(160),
    description: z.string().trim().max(3000),
    alert: z.string().trim().min(1).max(3000),
  })
  .strict();
export type BookingOption = z.infer<typeof bookingOptionSchema>;

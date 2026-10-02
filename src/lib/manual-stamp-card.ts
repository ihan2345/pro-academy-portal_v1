import { z } from "zod";

// Only identifiers cross the internal boundary; recipient and PDF come from the saved request.
export const manualStampCardRequest = z
  .object({ job_id: z.uuid(), actor_id: z.uuid() })
  .strict();
export type ManualStampCardRequest = z.infer<typeof manualStampCardRequest>;

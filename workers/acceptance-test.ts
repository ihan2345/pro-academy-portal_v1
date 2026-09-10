import { randomUUID } from "node:crypto";
import { z } from "zod";
import { serviceDb } from "../src/lib/server/service-db";
import { ProtonProvider, type Email } from "../src/lib/mail";
import { compose } from "./jobs";

type Environment = Record<string, string | undefined>;
export function acceptanceTestEnabled(env: Environment = process.env) {
  return (
    env.ACCEPTANCE_TEST_ENABLED === "true" &&
    env.JOBS_ENABLED === "false" &&
    env.MAIL_PROVIDER === "capture" &&
    env.EMAIL_TEST_MODE === "true" &&
    !!env.ACCEPTANCE_TEST_CONFIG
  );
}
export function acceptanceTestScope(env: Environment = process.env) {
  if (!acceptanceTestEnabled(env))
    throw new Error("Begrenzter Test deaktiviert");
  return z
    .object({
      participantId: z.uuid(),
      playerId: z.uuid(),
      parentId: z.uuid(),
      recipient: z.email().transform((s) => s.toLowerCase()),
    })
    .strict()
    .parse(JSON.parse(env.ACCEPTANCE_TEST_CONFIG!));
}

// Scope comes only from operator configuration, never from the HTTP request.
// This path calls neither runJobs(), processMail(), nor a global claim function.
export async function runAcceptanceTest(dependencies?: {
  db: ReturnType<typeof serviceDb>;
  compose: typeof compose;
  send: (mail: Email) => Promise<{ id: string }>;
}) {
  const scope = acceptanceTestScope();
  const db = dependencies?.db ?? serviceDb();
  const confirmed = await db.rpc("confirm_acceptance_attendance", {
    participant: scope.participantId,
    player: scope.playerId,
    parent: scope.parentId,
    recipient: scope.recipient,
  });
  if (confirmed.error) throw confirmed.error;
  const result = {
    ok: true,
    confirmed: Number(confirmed.data.confirmed),
    sent: 0,
  };
  const jobId = confirmed.data.job_id as string | null;
  if (!jobId) return result;
  const found = await db
    .from("notification_jobs")
    .select("*")
    .eq("id", jobId)
    .single();
  if (found.error) throw found.error;
  const job = found.data;
  if (
    job.kind !== "attendance" ||
    job.recipient.toLowerCase() !== scope.recipient ||
    job.payload.participant_id !== scope.participantId ||
    job.payload.player_id !== scope.playerId ||
    !job.idempotency_key.endsWith(`:${scope.parentId}`)
  ) {
    throw new Error("Versandauftrag liegt außerhalb des Testumfangs");
  }
  if (job.status === "sent") return result;
  if (job.status !== "pending" || job.attempts !== 0)
    throw new Error("Testversand vor Wiederholung manuell prüfen");
  const mail = await (dependencies?.compose ?? compose)(job);
  // Explicit one-off recipient, after matching the job and sole parent in SQL.
  // Global SMTP/test-recipient configuration remains untouched.
  mail.to = scope.recipient;
  const lease = randomUUID();
  const claimed = await db
    .from("notification_jobs")
    .update({
      status: "processing",
      attempts: 1,
      locked_at: new Date().toISOString(),
      lease_token: lease,
    })
    .eq("id", jobId)
    .eq("status", "pending")
    .eq("attempts", 0)
    .select("id");
  if (claimed.error || claimed.data?.length !== 1)
    throw new Error("Testversand wird bereits verarbeitet");
  try {
    const delivered = await (
      dependencies?.send ?? ((m) => new ProtonProvider().send(m))
    )(mail);
    const finished = await db.rpc("finish_notification", {
      input: {
        id: jobId,
        lease_token: lease,
        recipient: scope.recipient,
        provider: "proton",
        status: "sent",
        message_id: delivered.id,
      },
    });
    if (finished.error) throw finished.error;
    return { ...result, sent: 1 };
  } catch {
    // Never automatically retry an SMTP attempt whose outcome is uncertain.
    await db.rpc("finish_notification", {
      input: {
        id: jobId,
        lease_token: lease,
        recipient: scope.recipient,
        provider: "proton",
        status: "uncertain",
        error: "Begrenzter Test: Versand vor Wiederholung manuell prüfen",
      },
    });
    throw new Error("Testversand muss manuell geprüft werden");
  }
}

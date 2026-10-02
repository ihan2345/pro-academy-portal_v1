import { serviceDb } from "../src/lib/server/service-db";
import { HttpError, assertRole } from "../src/lib/server/security";
import { renderReport, type ReportSnapshot } from "../src/lib/pdf";
import {
  CaptureProvider,
  ProtonProvider,
  safeRecipient,
  htmlEmail,
  type MailProvider,
} from "../src/lib/mail";
import type { ManualStampCardRequest } from "../src/lib/manual-stamp-card";

/** Runs only in the Node mail container, never in the portal's Workers runtime. */
export async function deliverManualStampCard(
  { job_id: id, actor_id: actorId }: ManualStampCardRequest,
  provider: MailProvider = process.env.MAIL_PROVIDER === "proton"
    ? new ProtonProvider()
    : new CaptureProvider(),
) {
  if (process.env.CAMP_SIDE_EFFECTS_BLOCKED === "true")
    throw new HttpError(403, "Versand im lokalen Camp-Test gesperrt.");
  const adminDb = serviceDb();
  const { data: previous, error: previousError } = await adminDb
    .from("notification_jobs")
    .select("*")
    .eq("id", id)
    .single();
  if (previousError) throw previousError;
  if (
    !previous ||
    previous.kind !== "stamp_card" ||
    previous.payload?.manual_email !== true ||
    previous.payload.actor_id !== actorId
  )
    throw new HttpError(403, "Keine Berechtigung für diese Stempelkarte.");
  const actor = await adminDb
    .from("profiles")
    .select("role")
    .eq("id", actorId)
    .maybeSingle();
  if (actor.error) throw actor.error;
  assertRole(actor.data?.role, "team");
  const { data: job, error } = await adminDb
    .from("notification_jobs")
    .update({
      status: "processing",
      locked_at: new Date().toISOString(),
      lease_token: crypto.randomUUID(),
      attempts: previous.attempts + 1,
    })
    .eq("id", id)
    .eq("kind", "stamp_card")
    .eq("payload->>actor_id", actorId)
    .eq("payload->>manual_email", "true")
    .eq("status", "held")
    .eq("attempts", previous.attempts)
    .select("*")
    .maybeSingle();
  if (error) throw error;
  if (!job) {
    const { data: existing, error: readError } = await adminDb
      .from("notification_jobs")
      .select("status")
      .eq("id", id)
      .single();
    if (readError) throw readError;
    if (existing.status === "sent")
      return { id, captured: provider.name === "capture" };
    throw new HttpError(
      409,
      "Versand läuft oder Ergebnis unklar. Bitte Versandprotokoll prüfen; nicht erneut senden.",
    );
  }
  let started = false;
  let recipient = job.recipient;
  try {
    recipient =
      provider.name === "capture"
        ? job.recipient
        : safeRecipient(job.recipient);
    const snapshot = job.payload.snapshot as ReportSnapshot;
    const subject = `Stempelkarte für ${snapshot.player_name}`;
    const text = `Hallo,\nim Anhang findest du die aktuelle Stempelkarte für ${snapshot.player_name}. Zum Öffnen des PDFs ist keine Anmeldung im Elternportal erforderlich.`;
    const mail = {
      to: recipient,
      subject,
      text,
      html: htmlEmail(subject, text, `${process.env.APP_URL}/stempelkarte`),
      messageId: `<${id}@proacademy-portal.local>`,
      attachments: [
        {
          filename: "ProAcademy-Stempelkarte.pdf",
          content: Buffer.from(await renderReport(snapshot, "stamp_card")),
          contentType: "application/pdf",
        },
      ],
    };
    started = true;
    const result = await provider.send(mail);
    const final = await adminDb.rpc("finish_notification", {
      input: {
        id,
        lease_token: job.lease_token,
        recipient,
        provider: provider.name,
        status: "sent",
        message_id: result.id,
      },
    });
    if (final.error) throw final.error;
    return { id, captured: provider.name === "capture" };
  } catch (error) {
    // SMTP has not accepted any message during connection, TLS or authentication.
    const command = (error as { command?: string })?.command;
    const uncertain =
      started &&
      !["CONN", "EHLO", "HELO", "STARTTLS", "AUTH"].includes(command ?? "");
    const final = await adminDb.rpc("finish_notification", {
      input: {
        id,
        lease_token: job.lease_token,
        recipient,
        provider: provider.name,
        status: uncertain ? "uncertain" : "held",
        error:
          error instanceof Error ? error.message : "Versand fehlgeschlagen",
      },
    });
    if (final.error) throw final.error;
    throw new HttpError(
      502,
      uncertain
        ? "Versandergebnis unklar. Bitte Versandprotokoll prüfen, bevor erneut gesendet wird."
        : "Versand fehlgeschlagen. Bitte E-Mail-Konfiguration prüfen.",
    );
  }
}

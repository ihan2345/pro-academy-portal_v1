import { serviceDb } from "../src/lib/server/service-db";
import { formatDate, formatTime, whatsappLink } from "../src/lib/domain";
import { htmlEmail, safeRecipient, type Email } from "../src/lib/mail";

export const TRAINING_MAIL_KINDS = [
  "planning",
  "change",
  "training_removed",
  "training_reminder",
  "attendance",
];
const missingFunction = (error: { code?: string } | null) =>
  ["PGRST202", "42883"].includes(error?.code ?? "");

// Supports deploying the runner first; SQL activation is a separate explicit release step.
export async function planTrainingReminders(): Promise<number> {
  const { data, error } = await serviceDb().rpc("plan_training_reminders");
  if (missingFunction(error)) return 0;
  if (error) throw error;
  return data ?? 0;
}
export async function prepareTrainingNotification(
  job: Record<string, any>,
  verifyOnly = false,
) {
  const { data, error } = await serviceDb().rpc(
    "prepare_training_notification",
    {
      job_id: job.id,
      lease: job.lease_token,
      ...(verifyOnly ? { expected_details: job.payload?.notice_details } : {}),
    },
  );
  if (missingFunction(error) && !job.payload?.training_notice) return job;
  if (error) throw error;
  return data as Record<string, any> | null;
}
export async function composeTrainingNotice(
  job: Record<string, any>,
): Promise<Email> {
  const payload = job.payload;
  const details = payload.notice_details;
  const { data: player, error } = await serviceDb()
    .from("players")
    .select("first_name")
    .eq("id", payload.player_id)
    .single();
  if (error) throw error;
  if (!player) throw new Error("Kind nicht verfügbar");
  const kind = String(job.kind);
  const heading =
    kind === "planning"
      ? "Trainingsplanung"
      : kind === "change"
        ? "Trainingsplanung aktualisiert"
        : kind === "training_removed"
          ? "Teilnahme am Training aufgehoben"
          : "Trainingserinnerung";
  const subject = `${heading}: ${player.first_name} am ${formatDate(details.starts_at)}`;
  const contact = whatsappLink(
    process.env.WHATSAPP_NUMBER ?? "",
    player.first_name,
    details.starts_at,
    payload.event_id,
  );
  const intro =
    kind === "training_removed"
      ? `${player.first_name} wurde aus diesem Training entfernt und ist dafür nicht mehr eingeplant.`
      : kind === "change"
        ? `Die Trainingsplanung für ${player.first_name} wurde aktualisiert. Hier ist der aktuelle Stand:`
        : kind === "training_reminder"
          ? `Zur Erinnerung: Das Training von ${player.first_name} steht bevor.`
          : `Für ${player.first_name} ist folgendes Training geplant:`;
  const text = `Hallo,\n${intro}\n${details.title}\n${formatDate(details.starts_at)}, ${formatTime(details.starts_at)} bis ${formatTime(details.ends_at)} Uhr\n${details.location_name}, ${details.address}\nTrainer: ${details.trainer_name}\nFragen oder Änderungen? Bitte kontaktiere uns per WhatsApp:\n${contact}`;
  return {
    to:
      process.env.MAIL_PROVIDER === "capture"
        ? String(job.recipient)
        : safeRecipient(String(job.recipient)),
    subject,
    text,
    html: htmlEmail(subject, text, process.env.APP_URL ?? "", [
      { label: "Frage zum Training", url: contact },
    ]),
    messageId: `<${job.id}@proacademy-portal.local>`,
  };
}

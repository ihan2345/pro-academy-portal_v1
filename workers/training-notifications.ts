import { serviceDb } from "../src/lib/server/service-db";
import {
  formatDate,
  formatTime,
  durationMinutes,
  whatsappLink,
} from "../src/lib/domain";
import { htmlEmail, safeRecipient, type Email } from "../src/lib/mail";
import { greet, type MailLook } from "../src/lib/mail-2026/from-text";
import { mailCalendar } from "../src/lib/mail-2026/ics-link";
import { parentFirstName } from "../src/lib/server/parent-name";

export const TRAINING_MAIL_KINDS = [
  "planning",
  "change",
  "training_removed",
  "training_reminder",
  "attendance",
  "training_staff_attendance",
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
    job.kind === "training_staff_attendance"
      ? "prepare_staff_training_notification"
      : "prepare_training_notification",
    {
      job_id: job.id,
      lease: job.lease_token,
      ...(verifyOnly ? { expected_details: job.payload?.notice_details } : {}),
    },
  );
  if (
    missingFunction(error) &&
    job.kind !== "training_staff_attendance" &&
    !job.payload?.training_notice
  )
    return job;
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
  const text = greet(`Hallo,\n${intro}\n${details.title}\n${formatDate(details.starts_at)}, ${formatTime(details.starts_at)} bis ${formatTime(details.ends_at)} Uhr\n${details.location_name}, ${details.address}\nTrainer: ${details.trainer_name}\nFragen oder Änderungen? Bitte kontaktiere uns per WhatsApp:\n${contact}`, await parentFirstName(String(job.recipient)));
  const look: MailLook = {
    area: "Training",
    eyebrow: heading,
    title:
      kind === "training_removed"
        ? `${player.first_name} ist nicht mehr eingeplant.`
        : kind === "training_reminder"
          ? `Bald geht's los, ${player.first_name}.`
          : kind === "change"
            ? `Neuer Stand für ${player.first_name}.`
            : `${player.first_name} ist eingeplant.`,
    heroTime: {
      start: formatTime(details.starts_at),
      end: formatTime(details.ends_at),
      caption: details.title,
    },
    chips: [
      formatDate(details.starts_at),
      details.location_name,
      details.trainer_name,
    ].filter(Boolean),
  };
  let attachments: Email["attachments"];
  if (kind !== "training_removed") {
    const calendar = await mailCalendar({
      uid: `training-${payload.event_id}-${payload.player_id}`,
      title: `ProAcademy Training: ${player.first_name} · ${details.title}`,
      slots: [{ starts_at: details.starts_at, ends_at: details.ends_at }],
      location: [details.location_name, details.address].filter(Boolean).join(", "),
      description: `Trainer: ${details.trainer_name}`,
      url: process.env.APP_URL ?? undefined,
    });
    attachments = [calendar.attachment];
    if (calendar.links)
      look.calendar = {
        links: calendar.links,
        note:
          kind === "change"
            ? "Neuen Stand eintragen und den alten Termin im Kalender löschen. Mit Erinnerung 1 Tag und 2 Stunden vorher."
            : undefined,
      };
  }
  return {
    to:
      process.env.MAIL_PROVIDER === "capture"
        ? String(job.recipient)
        : safeRecipient(String(job.recipient)),
    subject,
    text,
    html: htmlEmail(
      subject,
      text,
      process.env.APP_URL ?? "",
      [{ label: "Frage zum Training", url: contact }],
      look,
    ),
    messageId: `<${job.id}@proacademy-portal.local>`,
    attachments,
  };
}

export function composeStaffTrainingConfirmation(
  job: Record<string, any>,
): Email {
  const details = job.payload.notice_details;
  const names = details.participants.map(
    (participant: { name: string }) => participant.name,
  );
  const subject = `Training absolviert: ${details.title}`;
  const contact = whatsappLink(
    process.env.WHATSAPP_NUMBER ?? "",
    names.join(", "),
    details.starts_at,
    job.payload.event_id,
    true,
  );
  const text = `Hallo,\ndas Training „${details.title}“ am ${formatDate(details.starts_at)} von ${formatTime(details.starts_at)} bis ${formatTime(details.ends_at)} Uhr wurde als absolviert eingetragen.\nTrainingsdauer: ${durationMinutes(details.starts_at, details.ends_at)} Minuten.\nOrt: ${details.location_name}, ${details.address}\nTrainer: ${details.trainer_name}\nBestätigte Teilnahmen (${names.length}):\n${names.join("\n")}\nIst diese Angabe aus deiner Sicht nicht korrekt? Kontaktiere uns bitte über WhatsApp.\n${contact}`;
  return {
    to:
      process.env.MAIL_PROVIDER === "capture"
        ? String(job.recipient)
        : safeRecipient(String(job.recipient)),
    subject,
    text,
    html: htmlEmail(subject, text, process.env.APP_URL ?? "", [], {
      area: "Team",
      eyebrow: "Training absolviert",
      title: details.title,
      heroTime: {
        start: formatTime(details.starts_at),
        end: formatTime(details.ends_at),
        caption: `${durationMinutes(details.starts_at, details.ends_at)} Minuten · ${names.length} Teilnahmen`,
      },
      primaryLabel: "Zum Portal",
      support: false,
    }),
    messageId: `<${job.id}@proacademy-portal.local>`,
  };
}

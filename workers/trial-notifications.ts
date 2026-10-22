import { serviceDb } from "../src/lib/server/service-db";
import { TRIAL_CONTACT, TRIAL_MAIL_KINDS } from "../src/lib/trials/domain";
import { trialToken } from "../src/lib/trials/tokens";
import { safeRecipient, type Email } from "../src/lib/mail";
import { formatDate, formatTime } from "../src/lib/domain";
import { trialEmailDesign } from "../src/lib/trials/mail-design";
export { TRIAL_MAIL_KINDS };
export async function planTrialNotifications(): Promise<number> {
  if (process.env.TRIAL_TRAINING_ENABLED !== "true") return 0;
  const { data, error } = await serviceDb().rpc("plan_trial_notifications");
  if (error) throw error;
  return data ?? 0;
}
export async function trialMailAllowed(job: Record<string, any>) {
  if (process.env.TRIAL_TRAINING_ENABLED !== "true") return false;
  const { data, error } = await serviceDb().rpc("trial_delivery_allowed", {
    recipient: job.recipient,
    kind: job.kind,
    payload: job.payload,
  });
  if (error) throw error;
  return data === true;
}
export async function holdTrialMail(
  job: Record<string, any>,
  provider: string,
) {
  const r = await serviceDb().rpc("finish_notification", {
    input: {
      id: job.id,
      lease_token: job.lease_token,
      recipient: job.recipient,
      provider,
      status: "held",
      error:
        "Probetraining: Teilnahme, Empfänger, Zustimmung oder Abo-Status hat sich geändert.",
    },
  });
  if (r.error) throw r.error;
}
export async function composeTrialMail(
  job: Record<string, any>,
): Promise<Email> {
  if (!(await trialMailAllowed(job)))
    throw new Error("Probetraining-Mail ist nicht freigegeben.");
  const db = serviceDb();
  const { data: family, error } = await db
    .from("trial_families")
    .select("id,parent_name,email,marketing_consent")
    .eq("id", job.payload.family_id)
    .single();
  if (error || !family)
    throw new Error("Probetraining-Familie nicht verfügbar.");
  const access = `${process.env.APP_URL}/probetraining/willkommen?token=${trialToken(family.id, process.env.SUPABASE_SERVICE_ROLE_KEY ?? "")}`;
  let subject = "Willkommen bei der ProAcademy",
    text = `Hallo ${family.parent_name},\nvielen Dank für eure kostenlose Probetraining-Anfrage! Bitte bestätigt eure E-Mail und öffnet euer Willkommensportal:\n${access}\nWir melden uns telefonisch, um einen passenden Trainingstermin abzustimmen. Ihr benötigt dafür kein Abo und keine Zahlungsdaten.`;
  const actions: { label: string; url: string }[] = [];
  if (job.kind !== "trial_welcome") {
    const { data: r, error } = await db
      .from("trial_team_overview")
      .select(
        "first_name,last_name,event_title,starts_at,ends_at,location_name,address,coach_name,academy_feedback,academy_rating,subscribed",
      )
      .eq("id", job.payload.request_id)
      .single();
    if (error || !r) throw new Error("Probetraining nicht verfügbar.");
    const child = `${r.first_name} ${r.last_name}`;
    const details = `${formatDate(r.starts_at)} · ${formatTime(r.starts_at)}–${formatTime(r.ends_at)} Uhr\n${r.location_name}, ${r.address}\nCoach: ${r.coach_name}`;
    if (["trial_planning", "trial_reminder"].includes(job.kind)) {
      subject = `${job.kind === "trial_reminder" ? "Erinnerung an euer Probetraining" : "Probetraining geplant"}: ${child}`;
      text = `Hallo ${family.parent_name},\nwir freuen uns auf ${child}!\n${details}\nBitte Sportsachen, passende Schuhe und etwas zu trinken mitbringen. Wenn ihr den Termin ändern müsst, meldet euch bitte beim Team.\nEuer Termin im Portal: ${access}`;
    } else if (job.kind === "trial_cancelled") {
      subject = `Probetraining: Termin bitte neu abstimmen – ${child}`;
      text = `Hallo ${family.parent_name},\ndie Teilnahme von ${child} am ${formatDate(r.starts_at)} findet nicht wie geplant statt oder wurde als Fehlzeit erfasst. Bitte meldet euch bei uns, damit wir den nächsten Schritt persönlich besprechen können.`;
    } else if (job.kind === "trial_feedback") {
      subject = `Euer Probetraining: Feedback für ${r.first_name}`;
      text = `Hallo ${family.parent_name},\nschön, dass ${child} bei uns war!\nHier ist das persönliche Feedback vom Coach:\nBewertung: ${r.academy_rating} von 5\n${r.academy_feedback}\n\nWie hat es euch gefallen? Im Willkommensportal könnt ihr mit einem Klick eine Bewertung abgeben und optional eine Nachricht hinterlassen:\n${access}`;
      actions.push({ label: "Probetraining bewerten", url: access });
    } else if (job.kind === "trial_day7") {
      subject = `Euer nächster Schritt mit der ProAcademy · ${r.first_name}`;
      text = `Hallo ${family.parent_name},\nnach dem Probetraining von ${child} am ${formatDate(r.starts_at)} möchten wir mit euch den nächsten Schritt planen. Regelmäßiges Training gibt Raum, Technik, Spielverständnis und Selbstvertrauen weiterzuentwickeln. Unser Portal unterstützt euch dabei mit einer gemeinsamen Terminübersicht, transparenten Einheiten und direktem Feedback.\nWenn ihr nach eurem Probetraining weitertrainieren möchtet, helfen wir euch persönlich bei der Auswahl eines passenden Angebots.`;
    } else {
      subject = "Academy und Vereinstraining: gemeinsam weiterentwickeln";
      text = `Hallo ${family.parent_name},\nwie geht es ${r.first_name} seit dem Probetraining? Wenn ihr noch überlegt, wie es für ${child} weitergehen kann, beraten wir euch gern. Unsere Academy ergänzt das Vereinstraining durch zusätzliche Schwerpunkte und persönliche Begleitung. Gemeinsam besprechen wir, welche Trainingszeiten und welches Angebot zu eurem Alltag passen.\nHabt ihr noch Fragen zum Einstieg? Meldet euch gern. Dies ist die letzte Nachricht unserer Probetraining-Angebotsfolge.`;
    }
    if (
      !r.subscribed &&
      family.marketing_consent &&
      ["trial_feedback", "trial_day7", "trial_day14"].includes(job.kind)
    )
      actions.push({
        label: "Academy-Angebote ansehen",
        url: "https://proacademy-ak.com/",
      });
  }
  text += `\n\nEuer ProAcademy-Team\n${TRIAL_CONTACT.email}\n${TRIAL_CONTACT.phone}`;
  if (["trial_day7", "trial_day14"].includes(job.kind))
    text += `\nWeitere Angebotsmails könnt ihr im Willkommensportal abbestellen: ${access}`;
  return {
    to:
      process.env.MAIL_PROVIDER === "capture"
        ? String(job.recipient)
        : safeRecipient(String(job.recipient)),
    subject,
    text,
    html: trialEmailDesign({
      title: subject,
      text,
      access,
      actions,
      ratingLinks:
        job.kind === "trial_feedback"
          ? [1, 2, 3, 4, 5].map(
              (rating) =>
                `${access}&request=${job.payload.request_id}&event=${job.payload.event_id}&rating=${rating}`,
            )
          : undefined,
    }),
    messageId: `<${job.id}@proacademy-portal.local>`,
  };
}

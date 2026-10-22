import { serviceDb } from "../src/lib/server/service-db";
import { TRIAL_CONTACT, TRIAL_MAIL_KINDS } from "../src/lib/trials/domain";
import { scopedTrialToken } from "../src/lib/trials/tokens";
import { trialLoginLink } from "../src/lib/trials/links";
import { safeRecipient, type Email } from "../src/lib/mail";
import { formatDate, formatTime } from "../src/lib/domain";
import { trialEmailDesign } from "../src/lib/trials/mail-design";
export { TRIAL_MAIL_KINDS };
export async function planTrialNotifications(): Promise<number> {
  if (process.env.TRIAL_TRAINING_ENABLED !== "true") return 0;
  const db = serviceDb();
  const cleanup = await db.rpc("cleanup_trial_data");
  if (cleanup.error) throw cleanup.error;
  const { data, error } = await db.rpc("plan_trial_notifications");
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
    .select("id,parent_id,parent_name,email,marketing_consent,created_at")
    .eq("id", job.payload.family_id)
    .single();
  if (error || !family)
    throw new Error("Probetraining-Familie nicht verfügbar.");
  // Only the welcome email carries a short-lived, single-use account login.
  const access =
    job.kind === "trial_welcome"
      ? await trialLoginLink(family)
      : `${process.env.APP_URL}/probetraining/willkommen`;
  const customerNotice = job.kind.startsWith("trial_customer_");
  const noticeKind = customerNotice
    ? job.kind.replace("trial_customer_", "trial_")
    : job.kind;
  let ratingLinks: string[] | undefined;
  let subject = "Willkommen bei der ProAcademy",
    text = `Hallo ${family.parent_name},\nvielen Dank für eure kostenlose Probetraining-Anfrage! Bitte bestätigt eure E-Mail und öffnet euer Willkommensportal:\n${access}\nWir melden uns telefonisch, um einen passenden Trainingstermin abzustimmen. Ihr benötigt dafür kein Abo und keine Zahlungsdaten.`;
  const actions: { label: string; url: string }[] = [];
  if (["trial_day7", "trial_day14"].includes(job.kind)) {
    const { data: children, error } = await db
      .from("trial_team_overview")
      .select("first_name,status,confirmed_at,converted_at")
      .eq("family_id", family.id)
      .is("converted_at", null)
      .neq("status", "closed");
    if (error) throw error;
    const names = (children ?? [])
      .filter((c) => c.confirmed_at)
      .map((c) => c.first_name)
      .join(", ");
    subject =
      job.kind === "trial_day7"
        ? "Euer nächster Schritt mit der ProAcademy"
        : "Academy und Vereinstraining: gemeinsam weiterentwickeln";
    text = `Hallo ${family.parent_name},\n${job.kind === "trial_day7" ? `nach dem Probetraining von ${names} möchten wir mit euch den nächsten Schritt planen. Regelmäßiges Training gibt Raum, Technik, Spielverständnis und Selbstvertrauen weiterzuentwickeln. Unser Portal unterstützt euch mit einer gemeinsamen Terminübersicht, transparenten Einheiten und persönlichem Feedback.` : `wie geht es ${names} seit dem Probetraining? Unsere Academy ergänzt das Vereinstraining mit persönlichen Schwerpunkten, Freude am Fußball und klaren nächsten Schritten. Wir besprechen gern passende Trainingszeiten und Angebote mit euch. Dies ist die letzte Nachricht unserer Probetraining-Angebotsfolge.`}`;
    actions.push({
      label: "Academy-Angebote ansehen",
      url: "https://proacademy-ak.com/",
    });
  } else if (job.kind !== "trial_welcome") {
    const { data: r, error } = await db
      .from("trial_team_overview")
      .select(
        "first_name,last_name,event_title,starts_at,ends_at,event_status,attendance,location_name,address,coach_name,academy_feedback,academy_rating,subscribed",
      )
      .eq("id", job.payload.request_id)
      .single();
    if (error || !r) throw new Error("Probetraining nicht verfügbar.");
    const child = `${r.first_name} ${r.last_name}`;
    const details = `${formatDate(r.starts_at)} · ${formatTime(r.starts_at)}–${formatTime(r.ends_at)} Uhr\n${r.location_name}, ${r.address}\nCoach: ${r.coach_name}`;
    if (["trial_planning", "trial_reminder"].includes(noticeKind)) {
      subject = `${noticeKind === "trial_reminder" ? "Erinnerung an euer Probetraining" : "Probetraining geplant"}: ${child}`;
      text = `Hallo ${family.parent_name},\nwir freuen uns auf ${child}!\n${details}\nBitte Sportsachen, passende Schuhe und etwas zu trinken mitbringen. Wenn ihr den Termin ändern müsst, meldet euch bitte beim Team.\nEuer Termin im Portal: ${access}`;
    } else if (noticeKind === "trial_cancelled") {
      const missed =
        r.attendance === "absent" && r.event_status !== "cancelled";
      const excused =
        r.attendance === "excused" && r.event_status !== "cancelled";
      subject = `${missed ? "Probetraining verpasst" : excused ? "Probetraining entschuldigt" : "Probetraining abgesagt"}: ${child}`;
      text = `Hallo ${family.parent_name},\n${missed ? `wir haben ${child} beim Probetraining am ${formatDate(r.starts_at)} vermisst.` : excused ? `die Teilnahme von ${child} am ${formatDate(r.starts_at)} wurde als entschuldigt eingetragen.` : `das Probetraining von ${child} am ${formatDate(r.starts_at)} findet nicht wie geplant statt.`} Bitte meldet euch beim Team, damit wir einen passenden Ersatztermin persönlich abstimmen können.`;
    } else if (job.kind === "trial_feedback") {
      subject = `Euer Probetraining: Feedback für ${r.first_name}`;
      text = `Hallo ${family.parent_name},\nschön, dass ${child} bei uns war!\nHier ist das persönliche Feedback vom Coach:\nBewertung: ${r.academy_rating} von 5\n${r.academy_feedback}\n\nWie hat es euch gefallen? Im Willkommensportal könnt ihr mit einem Klick eine Bewertung abgeben und optional eine Nachricht hinterlassen:\n${access}`;
      ratingLinks = [1, 2, 3, 4, 5].map((rating) => {
        const token = scopedTrialToken(
          {
            purpose: "rating",
            family: family.id,
            parent: family.parent_id,
            request: job.payload.request_id,
            event: job.payload.event_id,
            rating,
            expires: Date.parse(family.created_at) + 180 * 86400000,
          },
          process.env.SUPABASE_SERVICE_ROLE_KEY ?? "",
        );
        return `${process.env.APP_URL}/probetraining/willkommen?ratingToken=${encodeURIComponent(token)}`;
      });
      actions.push({ label: "Probetraining bewerten", url: access });
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
  if (customerNotice) {
    subject = subject.replace(/Probetraining/g, "Training");
    text = text.replace(/Probetraining/g, "Training");
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
      ratingLinks,
      customerNotice,
    }),
    messageId: `<${job.id}@proacademy-portal.local>`,
  };
}

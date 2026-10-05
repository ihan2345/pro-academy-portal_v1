import {
  TRAINING_MAIL_KINDS,
  planTrainingReminders,
  prepareTrainingNotification,
  composeTrainingNotice,
} from "./training-notifications";
import {
  CAMP_MAIL_KINDS,
  CampMailHeld,
  composeCampMail,
  planCampMail,
  requireCampMailRecipient,
} from "../src/lib/camps/notifications";
import { mkdir, writeFile } from "node:fs/promises";
import { backfillColumns, backfillEvent } from "../src/lib/backfills";
import type { TrainingBackfill } from "../src/lib/types";
import { optionalBackfills } from "../src/lib/server/v2-availability";
import { serviceDb } from "../src/lib/server/service-db";
import { processStripeInbox } from "../src/lib/server/stripe";
import { processReports } from "../src/lib/server/reports";
import { runCampProcessing } from "../src/lib/camps/processing";
import { campProcessingEnabled } from "../src/lib/camps/processing-config";
import { jobMode } from "./job-mode";
import { renderReport, type ReportSnapshot } from "../src/lib/pdf";
import {
  CaptureProvider,
  ProtonProvider,
  safeRecipient,
  htmlEmail,
  type Email,
  type MailProvider,
} from "../src/lib/mail";
import {
  attendanceStats,
  isRemovedParticipant,
  disciplineStats,
  formatDate,
  formatTime,
  whatsappLink,
  durationMinutes,
  durationLabel,
  periodLabel,
  type Attendance,
} from "../src/lib/domain";
export const captureProvider = new CaptureProvider(async (mail) => {
  await mkdir("output/mail", { recursive: true });
  const id = mail.messageId.replace(/[^a-zA-Z0-9-]/g, "_");
  await writeFile(
    `output/mail/${id}.json`,
    JSON.stringify(
      {
        ...mail,
        attachments: mail.attachments?.map((a) => ({
          filename: a.filename,
          bytes: a.content.length,
        })),
      },
      null,
      2,
    ),
    { mode: 0o600 },
  );
});
export async function compose(job: Record<string, unknown>): Promise<Email> {
  if (CAMP_MAIL_KINDS.includes(String(job.kind))) return composeCampMail(job);
  if (
    ["planning", "change", "training_removed", "training_reminder"].includes(
      String(job.kind),
    ) &&
    (job.payload as Record<string, unknown>)?.notice_details
  )
    return composeTrainingNotice(job);
  const db = serviceDb(),
    payload = job.payload as Record<string, string>,
    app = process.env.APP_URL ?? "",
    kind = String(job.kind);
  let subject = "",
    text = "",
    url = app,
    attachments: Email["attachments"];
  const actions: { label: string; url: string }[] = [];
  if (kind === "training_backfill") {
    const { data: links, error } = await db
      .from("parent_players")
      .select("parents!inner(id,contact_email,archived_at)")
      .eq("player_id", payload.player_id)
      .eq("parent_id", payload.parent_id)
      .is("parents.archived_at", null);
    if (error) throw error;
    const parent = links?.[0]?.parents as unknown as
      { contact_email: string } | undefined;
    if (!parent || parent.contact_email !== job.recipient)
      throw new Error(
        "Empfängerzuordnung der Nachtragung hat sich geändert; Versand prüfen.",
      );
    subject = `Eine Einheit wurde nachgetragen: ${payload.player_name}`;
    const contact = `https://wa.me/${(process.env.WHATSAPP_NUMBER ?? "").replace(/\D/g, "")}?text=${encodeURIComponent(`Hallo ProAcademy-Team, ich habe eine Frage zur Nachtragung für ${payload.player_name}. Nachtrags-ID: ${payload.backfill_id}.`)}`;
    text = `Hallo,\neine Einheit für ${payload.player_name} wurde nachgetragen.\nLeistungszeitraum: ${periodLabel(payload.period_starts_at, payload.period_ends_at)}.\n${payload.occurred_on ? `Trainingsdatum: ${formatDate(`${payload.occurred_on}T12:00:00Z`)}.` : "Trainingsdatum nicht angegeben."}\nTrainingsdauer: ${durationLabel(Number(payload.duration_minutes))}.\nNotiz des Teams:\n${payload.parent_note}\nDie aktualisierte Stempelkarte findest du im Elternportal.${payload.snapshot_id ? " Eine neue Berichtsversion wurde vorgemerkt und wird nach der PDF-Erstellung verfügbar." : ""}\nFragen oder Unstimmigkeiten? Kontaktiere uns per WhatsApp:\n${contact}`;
    url = `${app}/stempelkarte`;
    actions.push({ label: "Frage zur Nachtragung per WhatsApp", url: contact });
  } else if (kind === "stamp_card") {
    // Recheck recipient linkage at delivery time; never send a queued card to a removed parent.
    const { data: links, error } = await db
      .from("parent_players")
      .select("parents!inner(id,contact_email,archived_at)")
      .eq("player_id", payload.player_id)
      .eq("parent_id", payload.parent_id)
      .is("parents.archived_at", null);
    if (error) throw error;
    const parent = links?.[0]?.parents as unknown as
      { contact_email: string } | undefined;
    if (!parent || parent.contact_email !== job.recipient)
      throw new Error(
        "Empfängerzuordnung der Stempelkarte hat sich geändert; Versand prüfen.",
      );
    const snapshot = (job.payload as { snapshot: ReportSnapshot }).snapshot;
    subject = `Stempelkarte für ${snapshot.player_name}`;
    text = `Hallo,\nim Anhang findest du die Stempelkarte für ${snapshot.player_name}.\nDatenstand: ${formatDate(snapshot.created_at)}, ${formatTime(snapshot.created_at)} Uhr. Die Übersicht enthält absolvierte, nachgetragene und geplante Einheiten für den angegebenen Leistungszeitraum.\nDies ist eine aktuelle Stempelkarte; bestehende Berichtsversionen bleiben erhalten.`;
    url = `${app}/stempelkarte`;
    attachments = [
      {
        filename: "ProAcademy-Stempelkarte.pdf",
        content: Buffer.from(await renderReport(snapshot, "stamp_card")),
        contentType: "application/pdf",
      },
    ];
  } else if (kind === "invitation") {
    subject = "Deine Einladung zur ProAcademy";
    text = `Hallo ${payload.parent_name},\nwillkommen in deinem Elternportal. Deine persönliche Einladung ist sieben Tage gültig.\n${payload.url}`;
    url = payload.url;
  } else if (kind === "report") {
    subject = `Dein Trainingsbericht für ${payload.player_name}`;
    text = `Der neue Trainingsbericht von ${payload.player_name} ist verfügbar. Du findest ihn im Anhang und in deinem Elternportal.\nNoch ausstehende Teilnahmen sind im Bericht gekennzeichnet.`;
    url = `${app}/berichte`;
    const { data, error } = await db.storage
      .from("reports")
      .download(payload.storage_path);
    if (error || !data) throw error ?? new Error("PDF fehlt");
    attachments = [
      {
        filename: "ProAcademy-Trainingsbericht.pdf",
        content: Buffer.from(await data.arrayBuffer()),
        contentType: "application/pdf",
      },
    ];
  } else {
    const results = await Promise.all([
      db.from("players").select("*").eq("id", payload.player_id).single(),
      db
        .from("training_events")
        .select("*,locations(name,address),staff_profiles(display_name)")
        .eq("id", payload.event_id)
        .single(),
      db
        .from("entitlement_periods")
        .select("*")
        .eq("id", payload.period_id)
        .single(),
      db
        .from("event_participants")
        .select("*,training_events(starts_at,ends_at,event_type,status)")
        .eq("period_id", payload.period_id),
      optionalBackfills(
        db
          .from("training_backfills")
          .select(backfillColumns)
          .eq("period_id", payload.period_id)
          .limit(1000),
      ),
    ]);
    for (const r of results) if (r.error) throw r.error;
    const player = results[0].data!,
      event = results[1].data!,
      period = results[2].data!;
    const participation = (results[3].data ?? []).filter(
      (p) =>
        !isRemovedParticipant(p as Parameters<typeof isRemovedParticipant>[0]),
    ) as unknown as {
      status: Attendance;
      training_events: {
        status: string;
        starts_at: string;
        ends_at: string;
        event_type: string;
      };
    }[];
    const counted = [
      ...participation.map((p) => ({
        ...p.training_events,
        event_cancelled: p.training_events.status === "cancelled",
        status: p.status,
      })),
      ...((results[4].data ?? []) as unknown as TrainingBackfill[]).map(
        backfillEvent,
      ),
    ];
    const stats = attendanceStats(counted);
    const split = disciplineStats(counted);
    const progress =
      period.athletics_units > 0
        ? `Fußball: ${split.football.completed} von ${period.included_units - period.athletics_units}; Athletik: ${split.athletics.completed} von ${period.athletics_units} Einheiten`
        : `${stats.completed} von ${period.included_units} Einheiten`;
    const start = payload.starts_at ?? event.starts_at,
      end = payload.ends_at ?? event.ends_at;
    const next = participation
      .filter(
        (p) =>
          p.status === "planned" &&
          p.training_events.status !== "cancelled" &&
          p.training_events.starts_at > new Date().toISOString(),
      )
      .sort((a, b) =>
        a.training_events.starts_at.localeCompare(b.training_events.starts_at),
      )[0];
    const contact = whatsappLink(
      process.env.WHATSAPP_NUMBER ?? "",
      player.first_name,
      start,
      payload.event_id,
      kind === "attendance" || kind === "correction",
    );
    if (kind === "planning") {
      subject = `Training geplant: ${player.first_name} am ${formatDate(start)}`;
      text = `Hallo,\ndas nächste Training von ${player.first_name} ist geplant:\n${formatDate(start)}, ${formatTime(start)} bis ${formatTime(end)} Uhr\n${event.locations?.name}, ${event.locations?.address}\nTrainer: ${event.staff_profiles?.display_name}\nÄnderungen oder Stornierungen sind aktuell nur über unser Team möglich. Bitte kontaktiere uns per WhatsApp.\n${contact}`;
    } else if (kind === "attendance") {
      subject = `Training absolviert: ${player.first_name}`;
      text = `Das Training von ${player.first_name} am ${formatDate(start)} von ${formatTime(start)} bis ${formatTime(end)} Uhr wurde als absolviert eingetragen.\nTrainingsdauer: ${durationMinutes(start, end)} Minuten. Angerechnete Einheiten: ${progress}.\n${next ? `Nächste geplante Einheit: ${formatDate(next.training_events.starts_at)} um ${formatTime(next.training_events.starts_at)} Uhr.` : "Der nächste Termin wird von unserem Team geplant."}\nIst diese Angabe aus deiner Sicht nicht korrekt? Kontaktiere uns bitte über WhatsApp.\n${contact}`;
    } else {
      subject = `Training aktualisiert: ${player.first_name}`;
      text = `Unser Team hat das Training von ${player.first_name} am ${formatDate(start)} aktualisiert.\nAngerechnete Einheiten: ${progress}. Vom Team abgesagte Termine und entschuldigte Teilnahmen verbrauchen keine Einheit. Individuell abgesagte oder nicht wahrgenommene Teilnahmen zählen weiterhin als Einheit. Trainingszeit zählt nur bei tatsächlicher Teilnahme. Den aktuellen Termin- und Teilnahmestatus findest du im Elternportal.\nFragen oder Unstimmigkeiten? ${contact}`;
    }
  }
  const to =
    process.env.MAIL_PROVIDER === "capture"
      ? String(job.recipient)
      : safeRecipient(String(job.recipient));
  return {
    to,
    subject,
    text,
    html: htmlEmail(subject, text, url, actions),
    messageId: `<${job.id}@proacademy-portal.local>`,
    attachments,
  };
}
function deliveryFailure(
  error: unknown,
  attempts: number,
): "pending" | "failed" | "uncertain" {
  const e = error as { code?: string; command?: string; responseCode?: number };
  if (
    e.command === "DATA" ||
    ["ETIMEDOUT", "ECONNRESET", "ESOCKET"].includes(e.code ?? "")
  )
    return "uncertain";
  return attempts >= 5 ? "failed" : "pending";
}
export async function processMail(
  provider: MailProvider = process.env.MAIL_PROVIDER === "proton"
    ? new ProtonProvider()
    : captureProvider,
) {
  if (jobMode(process.env) === "stripe-only")
    throw new Error("Mail processing is disabled in Stripe-only mode");
  const db = serviceDb(),
    { data: jobs, error } = await db.rpc("claim_notifications", {
      batch_size: 20,
    });
  if (error) throw error;
  let sent = 0;
  for (let job of jobs ?? []) {
    let mail: Email | undefined,
      started = false;
    try {
      if (TRAINING_MAIL_KINDS.includes(String(job.kind))) {
        const current = await prepareTrainingNotification(job);
        if (!current) continue;
        job = current;
      }
      mail = await compose(job);
      if (CAMP_MAIL_KINDS.includes(String(job.kind)))
        await requireCampMailRecipient(job);
      if (
        TRAINING_MAIL_KINDS.includes(String(job.kind)) &&
        !(await prepareTrainingNotification(job, true))
      )
        continue;
      started = true;
      const result = await provider.send(mail);
      const final = await db.rpc("finish_notification", {
        input: {
          id: job.id,
          lease_token: job.lease_token,
          recipient: mail.to,
          provider: provider.name,
          status: "sent",
          message_id: result.id,
        },
      });
      if (final.error) throw final.error;
      sent++;
    } catch (error) {
      const status =
        error instanceof CampMailHeld
          ? "held"
          : started
            ? deliveryFailure(error, job.attempts)
            : job.attempts >= 5
              ? "failed"
              : "pending"; // A successful SMTP send followed by DB failure must also be quarantined.
      const final = await db.rpc("finish_notification", {
        input: {
          id: job.id,
          lease_token: job.lease_token,
          recipient: mail?.to ?? job.recipient,
          provider: provider.name,
          status:
            started && !(error as { code?: string }).code
              ? "uncertain"
              : status,
          error:
            error instanceof Error ? error.message : "Versand fehlgeschlagen",
        },
      });
      if (final.error) throw final.error;
    }
  }
  return sent;
}
export async function runJobs() {
  const mode = jobMode(process.env);
  if (mode === "disabled") throw new Error("Background jobs disabled");
  const db = serviceDb(),
    { data: run, error } = await db
      .from("job_runs")
      .insert({ status: "running" })
      .select("id")
      .single();
  if (error) throw error;
  const result: Record<string, number | string> = { mode },
    errors: string[] = [];
  const phases: Record<string, () => Promise<number>> = {
    stripe: processStripeInbox,
    camps: async () => {
      if (!campProcessingEnabled()) return 0;
      const result = await runCampProcessing();
      if (result.failed)
        throw new Error(
          `${result.failed} Camp-Angebote konnten nicht abgeglichen werden.`,
        );
      return result.sources;
    },
    camp_mail: planCampMail,
    training_reminders: planTrainingReminders,
    attendance: async () => {
      const r = await db.rpc("auto_attendance");
      if (r.error) throw r.error;
      return r.data;
    },
    reports: processReports,
    mail: () => processMail(),
    invitations: async () => {
      const r = await db
        .from("parent_invitations")
        .update({ expires_at: new Date().toISOString() })
        .is("consumed_at", null)
        .lt("expires_at", new Date(Date.now() - 86400000).toISOString())
        .select("id");
      if (r.error) throw r.error;
      return r.data?.length ?? 0;
    },
  };
  for (const [name, task] of Object.entries(phases)) {
    if (mode === "stripe-only" && name !== "stripe") continue;
    try {
      result[name] = await task();
    } catch (e) {
      const message = e instanceof Error ? e.message : "Job fehlgeschlagen";
      result[name] = message;
      errors.push(`${name}: ${message}`);
    }
  }
  const finished = await db
    .from("job_runs")
    .update({
      status: errors.length ? "failed" : "completed",
      result,
      error: errors.join("; ") || null,
    })
    .eq("id", run.id);
  if (finished.error) throw finished.error;
  return { ok: !errors.length, ...result };
}

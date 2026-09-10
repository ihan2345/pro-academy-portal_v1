import { mkdir, writeFile } from "node:fs/promises";
import { serviceDb } from "../src/lib/server/service-db";
import { processStripeInbox } from "../src/lib/server/stripe";
import { processReports } from "../src/lib/server/reports";
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
  disciplineStats,
  formatDate,
  formatTime,
  whatsappLink,
  durationMinutes,
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
  const db = serviceDb(),
    payload = job.payload as Record<string, string>,
    app = process.env.APP_URL ?? "",
    kind = String(job.kind);
  let subject = "",
    text = "",
    url = app,
    attachments: Email["attachments"];
  if (kind === "stamp_card") {
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
    text = `Hallo,\nim Anhang findest du die Stempelkarte für ${snapshot.player_name}.\nDatenstand: ${formatDate(snapshot.created_at)}, ${formatTime(snapshot.created_at)} Uhr. Die Übersicht enthält absolvierte und geplante Einheiten für den angegebenen Leistungszeitraum.\nDies ist eine aktuelle Stempelkarte; bestehende Monatsberichte bleiben unverändert.`;
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
        .select("status,training_events(starts_at,ends_at,event_type)")
        .eq("period_id", payload.period_id),
    ]);
    for (const r of results) if (r.error) throw r.error;
    const player = results[0].data!,
      event = results[1].data!,
      period = results[2].data!;
    const participation = results[3].data as unknown as {
      status: Attendance;
      training_events: {
        starts_at: string;
        ends_at: string;
        event_type: string;
      };
    }[];
    const stats = attendanceStats(
      participation.map((p) => ({ ...p.training_events, status: p.status })),
    );
    const split = disciplineStats(
      participation.map((p) => ({ ...p.training_events, status: p.status })),
    );
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
      text = `Das Training von ${player.first_name} am ${formatDate(start)} von ${formatTime(start)} bis ${formatTime(end)} Uhr wurde als absolviert eingetragen.\nTrainingsdauer: ${durationMinutes(start, end)} Minuten. Aktueller Stand: ${progress}.\n${next ? `Nächste geplante Einheit: ${formatDate(next.training_events.starts_at)} um ${formatTime(next.training_events.starts_at)} Uhr.` : "Der nächste Termin wird von unserem Team geplant."}\nIst diese Angabe aus deiner Sicht nicht korrekt? Kontaktiere uns bitte über WhatsApp.\n${contact}`;
    } else {
      subject = `Training aktualisiert: ${player.first_name}`;
      text = `Unser Team hat das Training von ${player.first_name} am ${formatDate(start)} aktualisiert.\nAktueller Stand: ${progress}. Den aktuellen Termin- und Teilnahmestatus findest du im Elternportal.\nFragen oder Unstimmigkeiten? ${contact}`;
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
    html: htmlEmail(subject, text, url),
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
  const db = serviceDb(),
    { data: jobs, error } = await db.rpc("claim_notifications", {
      batch_size: 20,
    });
  if (error) throw error;
  let sent = 0;
  for (const job of jobs ?? []) {
    let mail: Email | undefined,
      started = false;
    try {
      mail = await compose(job);
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
      const status = started
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
  const db = serviceDb(),
    { data: run, error } = await db
      .from("job_runs")
      .insert({ status: "running" })
      .select("id")
      .single();
  if (error) throw error;
  const result: Record<string, number | string> = {},
    errors: string[] = [];
  const phases: Record<string, () => Promise<number>> = {
    stripe: processStripeInbox,
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

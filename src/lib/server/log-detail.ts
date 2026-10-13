import "server-only";
import { z } from "zod";
import { serviceDb } from "./service-db";
import { assertRole, HttpError } from "./security";

const tables = z.enum([
  "notification_jobs",
  "notification_deliveries",
  "report_snapshots",
  "audit_log",
  "job_runs",
]);
type Row = Record<string, any>;
const titles: Record<string, string> = {
  notification_jobs: "E-Mail-Auftrag",
  notification_deliveries: "Versandversuch",
  report_snapshots: "Bericht",
  audit_log: "Änderungsprotokoll",
  job_runs: "Hintergrundausführung",
};
const kinds: Record<string, string> = {
  report: "Entwicklungsbericht",
  invitation: "Portal-Einladung",
  attendance: "Teilnahmebestätigung",
  planning: "Trainingsplanung",
  change: "Trainingsänderung",
  correction: "Korrektur",
  training_removed: "Entfernung aus dem Training",
  training_reminder: "Trainingserinnerung",
  training_staff_attendance: "Teilnahmebestätigung für Mitarbeiter",
  stamp_card: "Stempelkarte",
};

export function redactLog(value: unknown, key = ""): unknown {
  if (
    /token|secret|password|authorization|api[_-]?key|signed[_-]?url/i.test(key)
  )
    return "[ausgeblendet]";
  if (Array.isArray(value)) return value.map((v) => redactLog(v));
  if (value && typeof value === "object")
    return Object.fromEntries(
      Object.entries(value).map(([k, v]) => [k, redactLog(v, k)]),
    );
  if (typeof value === "string")
    return value
      .replace(
        /([?&](?:token|access_token|refresh_token|code|secret|signature)=)[^\s&#"]+/gi,
        "$1[ausgeblendet]",
      )
      .replace(/\b(?:sk|rk)_(?:live|test)_[A-Za-z0-9]+\b/g, "[ausgeblendet]")
      .replace(/Bearer\s+[^\s"\\]+/gi, "Bearer [ausgeblendet]")
      .replace(
        /\beyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\b/g,
        "[ausgeblendet]",
      )
      .replace(/(https?:\/\/)[^\s/@]+:[^\s/@]+@/g, "$1[ausgeblendet]@");
  return value;
}

export function renderLogDetail(table: string, record: Row, related: Row = {}) {
  const lines = [
    "PROACADEMY – PROTOKOLLDETAIL",
    `${titles[table] ?? table}: ${record.id}`,
    "",
    `Erstellt: ${record.created_at ?? "Nicht gespeichert"}`,
    `Zuletzt geändert: ${record.updated_at ?? "Nicht gespeichert"}`,
    "",
  ];
  const job: Row | undefined =
    table === "notification_jobs" ? record : related.job;
  if (job) {
    lines.push(
      "WAS IST GESCHEHEN?",
      `Art: ${kinds[job.kind] ?? job.kind} (${job.kind})`,
      `Auftrags-ID: ${job.id}`,
      `Empfänger: ${job.recipient}`,
      `Status: ${job.status}`,
      `Verarbeitungsversuche: ${job.attempts}`,
      `Frühester Verarbeitungszeitpunkt: ${job.available_at ?? "Nicht gespeichert"}`,
    );
    const explanations: Record<string, string> = {
      held: "Der Auftrag wird zurückgehalten und ist nicht für die automatische Verarbeitung freigegeben.",
      pending:
        "Der Auftrag wartet auf Verarbeitung. Termin und Versandfreigabe werden beim Abruf geprüft.",
      processing:
        "Ein Hintergrunddienst hat den Auftrag zur Verarbeitung übernommen. Dies bestätigt noch keinen Versand.",
      sent: "Der Auftrag ist als versendet protokolliert. Eine erfolgreiche SMTP-Annahme bestätigt keinen Eingang im Postfach.",
      failed:
        "Die Verarbeitung ist fehlgeschlagen. Details stehen im Fehler und den Versandversuchen.",
      uncertain:
        "Der Versandstatus ist unklar. Vor einer Wiederholung muss geprüft werden, ob die Nachricht bereits versendet wurde.",
    };
    lines.push(
      explanations[job.status] ??
        "Keine zusätzliche Statuserklärung vorhanden.",
    );
    if (job.kind === "stamp_card" && job.payload?.manual_email === true)
      lines.push(
        "Dies ist eine manuelle Stempelkarten-Mail. Sie wird nicht automatisch durch den Hintergrunddienst versendet.",
      );
    if (Number(job.attempts) === 0)
      lines.push(
        "Es wurde noch kein Verarbeitungsversuch für diesen Auftrag protokolliert.",
      );
    lines.push(
      `Gespeicherter Fehler/Sperrgrund: ${job.last_error || "Kein genauer Grund gespeichert; aus diesem Eintrag lässt sich die damalige Ursache nicht sicher ableiten."}`,
    );
    if (related.delivery_allowed !== undefined)
      lines.push(
        "",
        "HEUTIGE VERSANDFREIGABE",
        `Aktuell durch die Datenbank freigegeben: ${related.delivery_allowed ? "Ja" : "Nein"}`,
        "Diese Prüfung beschreibt den aktuellen Zustand, nicht zwingend den Zustand beim Anlegen. Sie gibt keine Nachricht frei und löst keinen Versand aus.",
      );
    if (related.release)
      lines.push(
        `Globaler Versand freigegeben: ${related.release.enabled ? "Ja" : "Nein"}`,
        `Empfänger in allgemeiner Freigabeliste: ${related.release.recipient ? "Ja" : "Nein"}`,
        "Für ausdrücklich bestätigte Trainingsnachrichten können gesonderte Freigaben gelten.",
      );
  } else if (table === "audit_log")
    lines.push(
      "WAS WURDE GEÄNDERT?",
      `Aktion: ${record.action}`,
      `Tabelle: ${record.table_name}`,
      `Datensatz-ID: ${record.record_id}`,
      `Akteur-ID: ${record.actor_id ?? "Kein Benutzer gespeichert"}`,
      `Akteurtyp: ${record.actor_type}`,
      `Begründung: ${record.reason || "Nicht gespeichert"}`,
      "Alte und neue Werte stehen unten im vollständigen Eintrag.",
    );
  else if (table === "report_snapshots")
    lines.push(
      "BERICHTSZUORDNUNG",
      `Kind-ID: ${record.player_id}`,
      `Leistungszeitraum-ID: ${record.period_id}`,
      `Version: ${record.version}`,
      "Dieser Eintrag dokumentiert einen Bericht. Er allein bestätigt keinen E-Mail-Versand.",
    );
  else if (table === "job_runs")
    lines.push(
      "HINTERGRUNDVERARBEITUNG",
      `Status: ${record.status}`,
      `Fehler: ${record.error || "Nicht gespeichert"}`,
      "Das Ergebnis der Ausführung steht unten. Es ist keine Zustellbestätigung für einzelne E-Mails.",
    );
  lines.push(
    "",
    "VOLLSTÄNDIGER GESPEICHERTER EINTRAG",
    JSON.stringify(redactLog(record), null, 2),
  );
  for (const [key, label] of [
    ["job", "ZUGEHÖRIGER E-MAIL-AUFTRAG"],
    ["deliveries", "VERSANDVERSUCHE"],
    ["audits", "ÄNDERUNGEN AM AUFTRAG"],
    ["parents", "ELTERNZUORDNUNG"],
    ["players", "KINDZUORDNUNG"],
    ["events", "TRAININGSZUORDNUNG"],
  ])
    if (related[key] !== undefined)
      lines.push("", label, JSON.stringify(redactLog(related[key]), null, 2));
  lines.push(
    "",
    "Zugriffstokens und Geheimnisse sind ausgeblendet. Zeitstempel enthalten die gespeicherte Zeitzone.",
  );
  return String(redactLog(lines.join("\n"))) + "\n";
}

export async function loadLogDetail(
  role: string | undefined,
  inputTable: string,
  inputId: string,
) {
  assertRole(role, "admin");
  const table = tables.parse(inputTable),
    id = z.uuid().parse(inputId),
    db = serviceDb();
  const { data: record, error } = await db
    .from(table)
    .select("*")
    .eq("id", id)
    .maybeSingle();
  if (error)
    throw new HttpError(503, "Protokolldetail konnte nicht geladen werden.");
  if (!record) throw new HttpError(404, "Protokolleintrag nicht gefunden.");
  const related: Row = {};
  let job = table === "notification_jobs" ? record : undefined;
  if (table === "notification_deliveries") {
    const result = await db
      .from("notification_jobs")
      .select("*")
      .eq("id", record.job_id)
      .maybeSingle();
    if (result.error)
      throw new HttpError(
        503,
        "Zugehöriger Auftrag konnte nicht geladen werden.",
      );
    job = result.data ?? undefined;
    related.job = job;
  }
  if (job) {
    const [deliveries, audits, release, allowed] = await Promise.all([
      db
        .from("notification_deliveries")
        .select("*")
        .eq("job_id", job.id)
        .order("attempt")
        .limit(1000),
      db
        .from("audit_log")
        .select("*")
        .eq("table_name", "notification_jobs")
        .eq("record_id", job.id)
        .order("created_at")
        .limit(1000),
      db
        .from("system_settings")
        .select("value")
        .eq("key", "portal_delivery_release")
        .maybeSingle(),
      db.rpc("parent_delivery_allowed", {
        recipient: job.recipient,
        kind: job.kind,
        payload: job.payload,
      }),
    ]);
    if (
      deliveries.error ||
      audits.error ||
      release.error ||
      allowed.error ||
      deliveries.data?.length === 1000 ||
      audits.data?.length === 1000
    )
      throw new HttpError(
        503,
        "Versanddetails konnten nicht vollständig geladen werden.",
      );
    related.deliveries = deliveries.data;
    related.audits = audits.data;
    related.delivery_allowed = allowed.data;
    related.release = {
      enabled: release.data?.value?.enabled === true,
      recipient: (release.data?.value?.recipients ?? []).includes(
        String(job.recipient).trim().toLowerCase(),
      ),
    };
    const parents = await db
      .from("parents")
      .select(
        "id,full_name,contact_email,auth_user_id,archived_at,notifications_held",
      )
      .eq("contact_email", job.recipient)
      .limit(100);
    if (parents.error)
      throw new HttpError(503, "Elternzuordnung konnte nicht geladen werden.");
    related.parents = parents.data;
    for (const [key, ref, fields] of [
      ["players", "player_id", "id,first_name,last_name"],
      ["training_events", "event_id", "id,title,starts_at,ends_at,status"],
    ]) {
      const target = job.payload?.[ref];
      if (!z.uuid().safeParse(target).success) continue;
      const r = await db
        .from(key)
        .select(fields)
        .eq("id", target)
        .maybeSingle();
      if (r.error)
        throw new HttpError(503, "Zuordnung konnte nicht geladen werden.");
      related[key === "training_events" ? "events" : key] = r.data;
    }
  }
  return {
    filename: `protokoll-${table}-${id}.txt`,
    text: renderLogDetail(table, record, related),
  };
}

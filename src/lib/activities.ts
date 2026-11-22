export type Activity = {
  id: string;
  at: string;
  title: string;
  text: string;
  subject: string | null;
  actor: string;
  tone: "normal" | "success" | "problem";
  help?: { text: string; href: string; label: string };
  /** Kurz beantwortet: Wer, Warum, Wie, Wann wirksam, Durch wen. */
  facts?: { label: string; value: string }[];
  /** Familie (Elternprofil) für Zusammenfassung und Direktlink. */
  family?: string;
  parentId?: string;
};
export type ActivityPage = {
  rows: Activity[];
  next: string | null;
  total: number;
};
export type ActivitySummary = { asOf: string; recent: number; open: number };

/** Explicit allowlist: no raw payload, provider error, amount or recipient survives. */
export function describeActivity(
  row: {
    id: string;
    occurred_at: string;
    kind: string;
    subject: string | null;
    actor: string;
    details: Record<string, string | undefined>;
    is_open: boolean;
  },
  admin: boolean,
): Activity {
  const d = row.details;
  let title = "Aktivität",
    text = "Eine Änderung wurde protokolliert.";
  let tone: Activity["tone"] = "normal";
  const statuses: Record<string, string> = {
    active: "aktiv",
    trialing: "Probezeit",
    canceled: "beendet",
    past_due: "Klärung ausstehend",
    unpaid: "Klärung ausstehend",
    paused: "pausiert",
    incomplete: "noch nicht abgeschlossen",
    incomplete_expired: "nicht abgeschlossen",
    planned: "eingeplant",
    attended_auto: "teilgenommen",
    attended_manual: "Teilnahme bestätigt",
    absent: "nicht erschienen",
    excused: "entschuldigt",
    cancelled: "abgesagt",
  };
  switch (row.kind) {
    case "player":
    case "parent": {
      const noun = row.kind === "player" ? "Spielerprofil" : "Elternprofil";
      title = `${noun} ${d.action === "INSERT" ? "angelegt" : d.action === "DELETE" ? "entfernt" : d.archived ? "archiviert" : "aktualisiert"}`;
      text =
        d.action === "INSERT"
          ? "Ein neues Profil wurde angelegt."
          : "Die Profildaten wurden geändert.";
      break;
    }
    case "training":
      title =
        d.action === "DELETE" || d.status === "cancelled"
          ? "Training abgesagt"
          : d.action === "INSERT"
            ? "Training angelegt"
            : "Training geändert";
      text = d.title
        ? `Training: ${d.title}.`
        : "Die Trainingsplanung wurde aktualisiert.";
      break;
    case "attendance":
      title =
        d.action === "DELETE" || d.removed === "true"
          ? "Aus Training entfernt"
          : d.action === "INSERT"
            ? "Für Training eingeplant"
            : "Teilnahme aktualisiert";
      text = `${d.title ? `${d.title}: ` : ""}${statuses[d.status ?? ""] ?? "Teilnahme geändert"}.`;
      break;
    case "backfill":
      title = "Training nachgetragen";
      text = "Eine bereits absolvierte Einheit wurde nachträglich erfasst.";
      break;
    case "assignment":
      title =
        d.action === "DELETE"
          ? "Abo-Zuordnung aufgehoben"
          : "Abo einem Kind zugeordnet";
      text = "Die Zuordnung zwischen Kind und Abo wurde aktualisiert.";
      break;
    case "period":
      title = "Abo-Zeitraum hinterlegt";
      text = `${d.product ?? "Abo"}${d.units ? ` · ${d.units} Einheiten` : ""}. Ein neuer Leistungszeitraum wurde übernommen.`;
      break;
    case "package":
      title = "Paketwechsel übernommen";
      text = `${d.previousProduct ?? "Bisheriges Paket"} → ${d.product ?? "Neues Paket"}.${d.units ? ` Das Kontingent beträgt jetzt ${d.units} Einheiten.` : ""} Bisherige Teilnahmen des Zeitraums bleiben erhalten.`;
      break;
    case "subscription":
      title =
        d.status === "canceled"
          ? "Abo beendet"
          : d.status === "past_due" || d.status === "unpaid"
            ? "Abo-Zahlung offen"
            : d.status === "active" && d.previousStatus === "trialing"
              ? "Abo gestartet"
              : d.status === "active" &&
                  ["past_due", "unpaid", "paused"].includes(
                    d.previousStatus ?? "",
                  )
                ? "Abo wieder aktiv"
                : "Abostatus geändert";
      text = `${statuses[d.previousStatus ?? ""] ?? "Bisheriger Status"} → ${statuses[d.status ?? ""] ?? "Neuer Status"}.`;
      tone =
        d.status === "canceled" ||
        d.status === "past_due" ||
        d.status === "unpaid"
          ? "problem"
          : "normal";
      break;
    case "cancellation":
      title =
        d.scheduled === "true"
          ? "Kündigung vorgemerkt"
          : "Kündigung zurückgenommen";
      text =
        d.scheduled === "true"
          ? d.cancelAt
            ? `Das Abo läuft noch bis ${germanDate(d.cancelAt)} und endet dann.`
            : "Das Abo endet zum Ende des laufenden Zeitraums."
          : "Das Abo läuft unverändert weiter.";
      break;
    case "review":
      title =
        d.status === "pending"
          ? "Abo-Zuordnung noch unklar"
          : d.status === "resolved"
            ? "Abo-Zuordnung geklärt"
            : "Abo-Prüfung nicht mehr aktuell";
      text =
        d.status === "pending"
          ? "Das geänderte Abo konnte noch keinem Kind eindeutig zugeordnet werden."
          : "Der Status der Kinderzuordnung wurde aktualisiert.";
      tone = row.is_open
        ? "problem"
        : d.status === "resolved"
          ? "success"
          : "normal";
      break;
    case "mail": {
      const kinds: Record<string, string> = {
        stamp_card: "Stempelkarte",
        report: "Bericht",
        invitation: "Einladung",
        planning: "Trainingsinformation",
        change: "Trainingsänderung",
        training_reminder: "Trainingserinnerung",
        training_staff_attendance: "Teilnahmebestätigung",
        training_backfill: "Nachtragsinformation",
        attendance: "Teilnahmebestätigung",
        trial_planning: "Probetraining-Termin",
        trial_reminder: "Probetraining-Erinnerung",
        trial_cancelled: "Probetraining-Absage",
        trial_feedback: "Probetraining-Feedback",
        trial_day7: "Probetraining-Folgemail Tag 7",
        trial_day14: "Probetraining-Folgemail Tag 14",
      };
      const noun =
        kinds[d.mailKind ?? ""] ??
        (d.mailKind?.startsWith("trial_") ? "Probetraining-Mail" : "Nachricht");
      title = `${noun} ${d.status === "sent" ? "versendet" : d.status === "uncertain" ? "– Versandstatus unklar" : "– Versand fehlgeschlagen"}`;
      text =
        d.status === "sent"
          ? "Der Mailserver hat die Nachricht angenommen. Das bestätigt noch nicht den Eingang im Postfach."
          : row.is_open
            ? "Der Versand konnte nicht sicher abgeschlossen werden."
            : "Dieser frühere Versandfehler wird nicht mehr als offen geführt.";
      tone =
        d.status === "sent" ? "success" : row.is_open ? "problem" : "normal";
      break;
    }
    case "report":
      title = "Berichtsversion angelegt";
      text =
        "Eine neue Berichtsversion wurde erstellt. Das ist noch keine Versandbestätigung.";
      break;
    case "stripe":
      title =
        d.status === "processed"
          ? "Abo-Abgleich abgeschlossen"
          : "Abo-Abgleich fehlgeschlagen";
      text = row.is_open
        ? "Eine Abo-Änderung konnte noch nicht vollständig übernommen werden."
        : "Der Abgleich ist nicht mehr als offenes Problem geführt.";
      tone = row.is_open ? "problem" : "normal";
      break;
    case "processing":
      title = "Hintergrundverarbeitung fehlgeschlagen";
      text = row.is_open
        ? "Der letzte abgeschlossene Hintergrundlauf meldet einen Fehler."
        : "Ein früherer Hintergrundlauf meldete einen Fehler. Inzwischen liegt ein neuerer Lauf vor.";
      tone = row.is_open ? "problem" : "normal";
      break;
  }
  const facts = activityFacts(row.kind, d, row.actor, admin);
  let help: Activity["help"];
  if (admin && row.is_open) {
    if (row.kind === "review")
      help = {
        text: "Öffne Übersicht → Abo-Zuordnungen prüfen. Vergleiche die vorgeschlagene bisherige Zuordnung mit dem passenden Kind und bestätige die richtige Auswahl. Bei mehreren Plätzen in einer Abo-Position müssen diese zunächst in Stripe getrennt werden.",
        href: "/admin",
        label: "Zur Abo-Prüfung",
      };
    else if (row.kind === "mail")
      help = {
        text: "Öffne Verwaltung → Produkte & Berichte → Protokolle. Prüfe den betroffenen E-Mail-Auftrag und dessen Versanddetails. Bei unklarem Versand zuerst im Proton-Versandprotokoll prüfen, ob die Nachricht bereits verschickt wurde. Nur wenn sie nicht versendet wurde, dort eine Wiederholung mit Prüfgrund veranlassen.",
        href: "/admin/protokolle",
        label: "Zu den Protokollen",
      };
    else
      help = {
        text: "Öffne Verwaltung → Produkte & Berichte → Protokolle und prüfe den letzten Hintergrundlauf. Bei einem Abo-Abgleich zusätzlich die Stripe-Zuordnung mit dem betroffenen Abo vergleichen. Den dort protokollierten Fehler beheben lassen; eine reine Aktualisierung dieser Aktivitätenliste startet keinen erneuten Abgleich.",
        href: "/admin/protokolle",
        label: "Zu den Protokollen",
      };
  }
  return {
    id: row.id,
    at: row.occurred_at,
    title,
    text,
    subject: row.subject,
    actor: row.actor,
    tone,
    ...(help ? { help } : {}),
    ...(facts.length ? { facts } : {}),
    ...(d.family ? { family: d.family } : {}),
    ...(admin && d.parentId && /^[0-9a-f-]{36}$/.test(d.parentId)
      ? { parentId: d.parentId }
      : {}),
  };
}

const germanDate = (iso: string) => {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso);
  return m ? `${m[3]}.${m[2]}.${m[1]}` : iso;
};
/** Stripe cancellation_details.reason */
const REASONS: Record<string, string> = {
  cancellation_requested: "Kündigung angefordert",
  payment_failed: "Zahlung fehlgeschlagen, Stripe hat das Abo beendet",
  payment_disputed: "Zahlung zurückgebucht (Rückbuchung)",
};
/** Stripe cancellation_details.feedback (Auswahl im Kündigungsportal) */
const FEEDBACK: Record<string, string> = {
  customer_service: "Unzufrieden mit dem Service",
  low_quality: "Qualität nicht ausreichend",
  missing_features: "Es fehlt etwas",
  other: "Sonstiges",
  switched_service: "Zu einem anderen Anbieter gewechselt",
  too_complex: "Zu kompliziert",
  too_expensive: "Zu teuer",
  unused: "Wird nicht genutzt",
};
const STRIPE_KINDS = [
  "subscription",
  "cancellation",
  "assignment",
  "review",
  "period",
  "package",
  "stripe",
];

/**
 * Wer, Warum, Wie, Wann: kurze Zeilen für Glocke und Aktivitäten. Gründe und
 * Kundenkommentare nur für Admins; Trainer sehen keine Abrechnungsdetails.
 */
export function activityFacts(
  kind: string,
  d: Record<string, string | undefined>,
  actor: string,
  admin: boolean,
): { label: string; value: string }[] {
  const facts: { label: string; value: string }[] = [];
  const who = [
    d.family && `Familie ${d.family}`,
    d.children && `Kind: ${d.children}`,
  ]
    .filter(Boolean)
    .join(" · ");
  if (who && kind !== "parent") facts.push({ label: "Wer", value: who });
  if (admin && (kind === "subscription" || kind === "cancellation")) {
    const customer = !!(d.feedback || d.comment);
    let why: string | undefined;
    if (d.reason === "cancellation_requested")
      why = customer
        ? "Vom Kunden selbst gekündigt (Kundenportal)"
        : "Kündigung angefordert (Kunde oder Stripe-Dashboard)";
    else if (d.reason) why = REASONS[d.reason] ?? d.reason;
    else if (
      kind === "subscription" &&
      (d.status === "past_due" || d.status === "unpaid")
    )
      why = "Letzte Zahlung fehlgeschlagen, Stripe versucht es erneut";
    else if (kind === "subscription" && d.status === "canceled")
      why = "Stripe hat keinen Grund übermittelt";
    if (why) facts.push({ label: "Warum", value: why });
    if (d.feedback)
      facts.push({
        label: "Angabe",
        value: FEEDBACK[d.feedback] ?? d.feedback,
      });
    if (d.comment)
      facts.push({ label: "Kommentar", value: `„${d.comment.trim()}“` });
  }
  if (kind === "subscription" && d.status === "canceled" && d.endedAt)
    facts.push({ label: "Wirksam", value: `seit ${germanDate(d.endedAt)}` });
  else if (kind === "cancellation" && d.scheduled === "true" && d.cancelAt)
    facts.push({ label: "Wirksam", value: `zum ${germanDate(d.cancelAt)}` });
  facts.push({
    label: "Durch",
    value:
      actor === "Automatisch"
        ? STRIPE_KINDS.includes(kind)
          ? "Stripe (automatisch)"
          : "Automatisch (Portal)"
        : actor,
  });
  return facts;
}

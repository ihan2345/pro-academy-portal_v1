export type Activity = {
  id: string;
  at: string;
  title: string;
  text: string;
  subject: string | null;
  actor: string;
  tone: "normal" | "success" | "problem";
  help?: { text: string; href: string; label: string };
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
      title = "Abostatus geändert";
      text = `${statuses[d.previousStatus ?? ""] ?? "Bisheriger Status"} → ${statuses[d.status ?? ""] ?? "Neuer Status"}.`;
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
      };
      const noun = kinds[d.mailKind ?? ""] ?? "Nachricht";
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
  };
}

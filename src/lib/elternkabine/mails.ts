// Mails rund um das Zweitkonto. Dieselben Texte für Vorschau und Versand.
import type { MailLook } from "../mail-2026/from-text";

export const CO_PARENT_MAIL_KINDS = [
  "co_parent_invitation",
  "co_parent_removed",
] as const;

export function coParentMail(
  kind: string,
  payload: Record<string, string>,
  app: string,
): { subject: string; text: string; url: string; look: MailLook } {
  const name = payload.first_name ? `Hallo ${payload.first_name},` : "Hallo,";
  if (kind === "co_parent_invitation")
    return {
      subject: `${payload.main_name} hat dich ins Elternportal eingeladen`,
      text: `${name}\n${payload.main_name} hat dich als zweiten Elternteil zur ProAcademy eingeladen. Du siehst dann dieselben Kinder, Termine, den Fortschritt und die Elternkabine, also die Community für Eltern.\nMelde dich einfach mit dieser E-Mail-Adresse an. Du bekommst einen Anmeldecode, ein Passwort brauchst du nicht.\nÄndern, buchen oder kündigen kann weiterhin nur das Hauptkonto.`,
      url: `${app}/login`,
      look: {
        area: "Elternportal",
        eyebrow: "Einladung als zweiter Elternteil",
        primaryLabel: "Jetzt anmelden",
      },
    };
  return {
    subject: "Dein Zugang als zweiter Elternteil wurde beendet",
    text: `${name}\n${
      payload.reason === "main_archived"
        ? "Das Elternkonto, mit dem du verbunden warst, wurde geschlossen."
        : `${payload.main_name} hat deinen Zugang als zweiter Elternteil beendet.`
    } Du kannst das Elternportal und die Elternkabine ab sofort nicht mehr öffnen.\nBei Fragen melde dich gern direkt bei uns.`,
    url: app,
    look: { area: "Elternportal", eyebrow: "Zugang beendet" },
  };
}

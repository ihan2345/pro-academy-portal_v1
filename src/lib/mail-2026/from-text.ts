/*
 * Baut aus den bestehenden Klartext-Mails (Betreff, Text, Links) das
 * Design-2026-Layout. So bleiben Inhalte und Klartext-Version unverändert,
 * nur die HTML-Darstellung ist neu.
 */
import {
  renderMail2026,
  type Mail2026,
  type MailFlowItem,
  type MailLink,
} from "./render";

export interface MailLook {
  /** Kleines Label oben rechts. Standard: „Elternportal“. */
  area?: string;
  eyebrow?: string;
  title?: string;
  subtitle?: string;
  primaryLabel?: string;
  heroTime?: Mail2026["heroTime"];
  heroCode?: Mail2026["heroCode"];
  heroStat?: Mail2026["heroStat"];
  chips?: string[];
  calendar?: Mail2026["calendar"];
  rating?: Mail2026["rating"];
  attachment?: Mail2026["attachment"];
  callout?: Mail2026["callout"];
  signature?: string;
  /** Ohne Elternportal-Button (z. B. Team-Mails). */
  noPrimary?: boolean;
  /** Kontaktkarte „Wir sind für dich da.“ (Standard: an). */
  support?: boolean;
}

const URL_ONLY = /^(https?:\/\/|mailto:|tel:)\S+$/;
const TRAILING_URL = /^(.*?)[\s:]*((?:https?:\/\/|mailto:)\S+)$/;
const FACT = /^([A-Za-zÄÖÜäöüß0-9][^:?!]{1,46}?):\s+(.+)$/;
const DATE_LINE = /^((?:[A-Za-z]{2},\s*)?\d{2}\.\d{2}\.\d{4})\s*[·,]\s*(.+)$/;

/** Vorname aus einem vollständigen Namen. */
export function firstName(name?: string | null) {
  return (name ?? "").trim().split(/\s+/)[0] ?? "";
}

/** Ersetzt die Anrede „Hallo,“ am Anfang durch „Hallo <Vorname>,“. */
export function greet(text: string, name?: string | null) {
  const first = firstName(name);
  if (!first) return text;
  return text.replace(/^Hallo,/, `Hallo ${first},`);
}

function buttonLabel(url: string) {
  if (url.startsWith("https://wa.me/")) return "Per WhatsApp schreiben";
  if (url.startsWith("mailto:")) return "Per E-Mail schreiben";
  return "Link öffnen";
}

export function textToMail(
  subject: string,
  text: string,
  url: string,
  actions: MailLink[] = [],
  look: MailLook = {},
): Mail2026 {
  const lines = text
    .split("\n")
    .map((l) => l.trim())
    .filter(Boolean);
  const used = new Set([url, ...actions.map((a) => a.url)]);
  const extra: MailLink[] = [];
  const flow: MailFlowItem[] = [];
  let greeting: string | undefined;
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (i === 0 && /^Hallo\b[^.!?]*,$/.test(line)) {
      greeting = line;
      continue;
    }
    if (URL_ONLY.test(line)) {
      if (!used.has(line)) {
        used.add(line);
        extra.push({ label: buttonLabel(line), url: line });
      }
      continue;
    }
    const trailing = line.match(TRAILING_URL);
    if (trailing && trailing[1]) {
      const href = trailing[2];
      const label = trailing[1].replace(/[:\s]+$/, "");
      if (!used.has(href)) {
        used.add(href);
        extra.push({ label: label.length <= 48 ? label : buttonLabel(href), url: href });
      }
      if (label.length > 48) flow.push({ type: "p", text: label });
      continue;
    }
    const date = line.match(DATE_LINE);
    if (date) {
      flow.push({ type: "fact", label: date[1], value: date[2] });
      continue;
    }
    if (/^[^.!?]{2,40}:$/.test(line) && !/^Hallo/.test(line) && lines[i + 1]) {
      const body = [lines[++i]];
      while (
        lines[i + 1] &&
        lines[i + 1].length <= 40 &&
        !/[.?!:]$/.test(lines[i + 1]) &&
        !URL_ONLY.test(lines[i + 1])
      )
        body.push(lines[++i]);
      flow.push({ type: "quote", title: line.slice(0, -1), text: body.join("\n") });
      continue;
    }
    const fact = line.match(FACT);
    if (fact && !/^Hallo/.test(fact[1]) && fact[2].length <= 90) {
      const value = fact[2].replace(/\.$/, "");
      flow.push({
        type: "fact",
        label: fact[1],
        value,
        tone: /^−|^-\d/.test(value)
          ? "purple"
          : /^(Bezahlt|Restbetrag|Dein Restbetrag)/.test(fact[1])
            ? "lime"
            : /nummer|ID\b/i.test(fact[1])
              ? "muted"
              : undefined,
      });
      continue;
    }
    flow.push({ type: "p", text: line });
  }
  const split = subject.indexOf(": ");
  const eyebrow =
    look.eyebrow ?? (split > 0 ? subject.slice(0, split) : "ProAcademy");
  const rawTitle = look.title ?? (split > 0 ? subject.slice(split + 2) : subject);
  const title = rawTitle.charAt(0).toUpperCase() + rawTitle.slice(1);
  const whatsapp = (process.env.WHATSAPP_NUMBER ?? "").replace(/\D/g, "");
  return {
    preheader: look.subtitle ?? (flow.find((f) => f.type === "p") as { text?: string } | undefined)?.text?.slice(0, 120) ?? subject,
    area: look.area ?? "Elternportal",
    eyebrow,
    title,
    subtitle: look.subtitle,
    heroTime: look.heroTime,
    heroCode: look.heroCode,
    heroStat: look.heroStat,
    chips: look.chips,
    primary:
      look.noPrimary || !url
        ? undefined
        : { label: look.primaryLabel ?? "Zum Elternportal", url },
    greeting,
    flow,
    calendar: look.calendar,
    rating: look.rating,
    attachment: look.attachment,
    callout: look.callout,
    secondary: [...actions, ...extra],
    signature: look.signature,
    support:
      look.support === false
        ? undefined
        : {
            whatsapp: whatsapp ? `https://wa.me/${whatsapp}` : undefined,
            email: "contact@proacademy-ak.com",
          },
  };
}

export function textMailHtml(
  subject: string,
  text: string,
  url: string,
  actions: MailLink[] = [],
  look: MailLook = {},
) {
  let assetBase = "https://portal.proacademy-ak.com";
  try {
    if (url) assetBase = new URL(url).origin;
  } catch {
    /* Standard-Domain verwenden */
  }
  return renderMail2026(textToMail(subject, text, url, actions, look), {
    assetBase,
  });
}

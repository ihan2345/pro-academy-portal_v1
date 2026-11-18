/*
 * ProAcademy Mail-Design 2026 (Vorschau)
 * --------------------------------------
 * Gemeinsames HTML-Layout für alle Portal-Mails in der Design-2026-Sprache
 * (dunkle Hero-Karte, Neon-Lime + Violett, weiche Karten, Pillen-Chips).
 *
 * Reine Funktion ohne Abhängigkeiten: Sie wird aktuell NUR von der Vorschau
 * (scripts/mail-preview-2026.ts) genutzt. Kein Versandweg ruft sie auf, es wird
 * also nichts verschickt und keine bestehende Mail verändert.
 *
 * Mail-Client-tauglich: Tabellen-Layout, Inline-Styles, Fallback-Farben für
 * Clients ohne Verläufe (Outlook), max. 600 px, Media Query für Handys.
 */

export type MailTone = "lime" | "purple" | "neutral";
export interface MailLink {
  label: string;
  url: string;
}
export interface MailFact {
  label: string;
  value: string;
  /** Wert farbig hervorheben, z. B. Restguthaben oder Rabatt. */
  tone?: "lime" | "purple" | "muted";
}
export interface Mail2026 {
  /** Unsichtbare Vorschauzeile im Posteingang. */
  preheader: string;
  /** Kleines Label oben rechts, z. B. „Elternportal“. */
  area: string;
  /** Grüne Zeile mit Punkt über dem Titel, z. B. „NÄCHSTES TRAINING“. */
  eyebrow: string;
  title: string;
  subtitle?: string;
  /** Große Uhrzeit wie auf der Heute-Seite: Start hell, Ende grau. */
  heroTime?: { start: string; end: string; caption?: string };
  /** Großer Code (Anmeldecode, Geschenkcode). */
  heroCode?: { value: string; caption?: string; digits?: boolean };
  /** Große Kennzahl, z. B. Guthaben oder „4 / 4“. */
  heroStat?: { value: string; unit?: string; caption?: string };
  chips?: string[];
  primary?: MailLink;
  greeting?: string;
  paragraphs?: string[];
  /** Inhalt in fester Reihenfolge (aus Klartext-Mails abgeleitet). */
  flow?: MailFlowItem[];
  factsTitle?: string;
  facts?: MailFact[];
  list?: { title: string; items: string[] };
  quote?: { title: string; text: string; meta?: string };
  callout?: { title?: string; text: string; tone?: MailTone };
  rating?: { title: string; text: string; urls: string[] };
  attachment?: { name: string; note: string };
  /** „In Kalender eintragen“ mit Buttons je Plattform (siehe calendar.ts). */
  calendar?: {
    links: { google: string; outlook: string; ics: string };
    note?: string;
  };
  secondary?: MailLink[];
  /** Hinweisbox erst nach den Zusatz-Buttons zeigen (z. B. Link-Hinweis beim Login). */
  calloutAfterActions?: boolean;
  /** Kleiner grauer Hinweis am Ende (Gültigkeit, Sicherheit, Abmelden). */
  fineprint?: string[];
  signature?: string;
  /** Kontaktkarte „Wir sind für dich da.“ */
  support?: { whatsapp?: string; email?: string };
}

export type MailFlowItem =
  | { type: "p"; text: string }
  | { type: "fact"; label: string; value: string; tone?: MailFact["tone"] }
  | { type: "quote"; title: string; text: string };

/** Platzhalter für nachträglich eingefügtes HTML (z. B. Geschenkkarten-Bilder). */
export const MAIL_EXTRA_SLOT = "<!--pa-extra-->";

export const MAIL_2026 = {
  bg: "#f5f5f7",
  ink: "#1d1d1f",
  muted: "#6e6e73",
  hair: "#e8e8ed",
  card: "#ffffff",
  night: "#0b0f1a",
  lime: "#8eff01",
  limeInk: "#0b0f1a",
  limeTint: "#f1ffe0",
  purple: "#8b53fe",
  purpleTint: "#f3edff",
  font: "-apple-system,BlinkMacSystemFont,'SF Pro Display','SF Pro Text','Helvetica Neue',Helvetica,Arial,sans-serif",
} as const;

const c = MAIL_2026;

export function esc(text: string) {
  return text.replace(
    /[&<>"']/g,
    (ch) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[
        ch
      ]!,
  );
}

/** Mehrzeiliger Text: Zeilenumbrüche bleiben erhalten. */
function lines(text: string) {
  return esc(text).replace(/\n/g, "<br>");
}

function button(link: MailLink, kind: "primary" | "secondary" | "dark") {
  const styles = {
    primary: `background:${c.lime};color:${c.limeInk};`,
    secondary: `background:${c.bg};color:${c.ink};`,
    dark: `background:${c.night};color:#ffffff;`,
  }[kind];
  return `<table role="presentation" cellspacing="0" cellpadding="0" border="0" style="border-collapse:separate"><tr><td class="m-btn" style="border-radius:999px;${styles}"><a href="${esc(link.url)}" style="display:inline-block;padding:15px 26px;border-radius:999px;font-family:${c.font};font-size:16px;font-weight:600;letter-spacing:-0.01em;text-decoration:none;${styles}">${esc(link.label)}&nbsp;&nbsp;&#8599;</a></td></tr></table>`;
}

function hero(m: Mail2026) {
  const chips = (m.chips ?? [])
    .map(
      (chip) =>
        `<span class="m-chip" style="display:inline-block;margin:0 6px 8px 0;padding:8px 14px;border-radius:999px;background:#1d2130;border:1px solid #2a2f40;color:#e9e9f0;font-size:14px;line-height:18px;white-space:nowrap">${esc(chip)}</span>`,
    )
    .join("");
  const time = m.heroTime
    ? `<div class="m-time" style="margin:26px 0 4px;font-size:58px;line-height:1;font-weight:700;letter-spacing:-0.045em;color:#ffffff">${esc(m.heroTime.start)}<span style="color:#7d7f8c"> &ndash; ${esc(m.heroTime.end)}</span></div>${m.heroTime.caption ? `<div style="font-size:21px;font-weight:600;letter-spacing:-0.02em;color:#ffffff;margin:10px 0 0">${esc(m.heroTime.caption)}</div>` : ""}`
    : "";
  const code = m.heroCode
    ? `<div style="margin:26px 0 0">${
        m.heroCode.digits
          ? `<table role="presentation" cellspacing="0" cellpadding="0" border="0" style="border-collapse:separate"><tr>${[
              ...m.heroCode.value,
            ]
              .map(
                (d) =>
                  `<td class="m-digit" style="width:52px;height:64px;padding:0 3px 0 0"><div style="width:48px;height:62px;line-height:62px;border-radius:14px;background:#1d2130;border:1px solid #2a2f40;text-align:center;font-size:32px;font-weight:700;color:#ffffff">${esc(d)}</div></td>`,
              )
              .join("")}</tr></table>`
          : `<div class="m-code" style="display:inline-block;padding:16px 22px;border-radius:16px;background:#1d2130;border:1px solid #2a2f40;font-family:'SF Mono',Menlo,Consolas,monospace;font-size:30px;font-weight:700;letter-spacing:6px;color:#ffffff">${esc(m.heroCode.value)}</div>`
      }${m.heroCode.caption ? `<div style="margin-top:10px;font-size:12px;letter-spacing:1.6px;text-transform:uppercase;color:#9a9cab">${esc(m.heroCode.caption)}</div>` : ""}</div>`
    : "";
  const stat = m.heroStat
    ? `<div style="margin:24px 0 0"><span class="m-stat" style="font-size:60px;line-height:1;font-weight:700;letter-spacing:-0.045em;color:#ffffff">${esc(m.heroStat.value)}</span>${m.heroStat.unit ? `<span style="font-size:24px;font-weight:600;color:#9a9cab">&nbsp;${esc(m.heroStat.unit)}</span>` : ""}${m.heroStat.caption ? `<div style="margin-top:10px;font-size:15px;color:#b9bac6">${esc(m.heroStat.caption)}</div>` : ""}</div>`
    : "";
  return `<tr><td class="m-pad-x" style="padding:0 20px">
<table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" bgcolor="${c.night}" style="border-collapse:separate;border-radius:28px;background-color:${c.night};background-image:radial-gradient(120% 90% at 100% 0%,#4a2a9a 0%,rgba(74,42,154,0.55) 30%,rgba(11,15,26,0) 65%),radial-gradient(70% 60% at 0% 100%,rgba(142,255,1,0.16) 0%,rgba(11,15,26,0) 70%)">
<tr><td class="m-hero" style="padding:34px 36px 32px;font-family:${c.font};color:#ffffff">
<div style="font-size:13px;font-weight:700;letter-spacing:2.2px;text-transform:uppercase;color:${c.lime}"><span style="display:inline-block;width:10px;height:10px;border-radius:50%;background:${c.lime};margin-right:8px;vertical-align:1px"></span>${esc(m.eyebrow)}</div>
<h1 class="m-title" style="margin:16px 0 0;font-size:36px;line-height:1.08;font-weight:700;letter-spacing:-0.035em;color:#ffffff">${esc(m.title)}</h1>
${m.subtitle ? `<p style="margin:12px 0 0;font-size:17px;line-height:1.5;color:#b9bac6">${lines(m.subtitle)}</p>` : ""}
${time}${code}${stat}
${chips ? `<div style="margin:22px 0 0">${chips}</div>` : ""}
${m.primary ? `<div style="margin:${chips ? 14 : 26}px 0 0">${button(m.primary, "primary")}</div>` : ""}
</td></tr></table>
</td></tr>`;
}

function facts(m: Pick<Mail2026, "facts" | "factsTitle">) {
  if (!m.facts?.length) return "";
  const toneColor = { lime: "#3f8f00", purple: c.purple, muted: c.muted };
  return `${m.factsTitle ? `<h2 style="margin:0 0 6px;font-size:19px;font-weight:700;letter-spacing:-0.02em;color:${c.ink}">${esc(m.factsTitle)}</h2>` : ""}<table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="margin:0 0 22px">${m.facts
    .map(
      (f, i) =>
        `<tr><td class="m-fact-l" style="padding:13px 12px 13px 0;${i ? `border-top:1px solid ${c.hair};` : ""}font-size:15px;line-height:1.4;color:${c.muted};vertical-align:top">${esc(f.label)}</td><td class="m-fact-v" align="right" style="padding:13px 0;${i ? `border-top:1px solid ${c.hair};` : ""}font-size:15px;line-height:1.4;font-weight:600;color:${f.tone ? toneColor[f.tone] : c.ink};text-align:right;vertical-align:top">${lines(f.value)}</td></tr>`,
    )
    .join("")}</table>`;
}

function actions(m: Mail2026) {
  return `<div style="margin:2px 0 20px">${(m.secondary ?? []).map((s) => `<div style="margin:0 0 10px">${button(s, "secondary")}</div>`).join("")}</div>`;
}

function calendar(cal: NonNullable<Mail2026["calendar"]>, base: string) {
  const tiles = [
    { icon: "kalender-apple", label: "Apple", sub: "iPhone & Mac", url: cal.links.ics },
    { icon: "kalender-google", label: "Google", sub: "Android & Web", url: cal.links.google },
    { icon: "kalender-outlook", label: "Outlook", sub: "Windows & Web", url: cal.links.outlook },
    { icon: "kalender-datei", label: "Andere", sub: ".ics-Datei", url: cal.links.ics },
  ];
  const tile = (t: (typeof tiles)[number]) =>
    `<td class="m-cal" width="50%" style="padding:5px;vertical-align:top"><a href="${esc(t.url)}" style="display:block;padding:12px;border-radius:18px;border:1px solid ${c.hair};background:#ffffff;text-decoration:none"><table role="presentation" cellspacing="0" cellpadding="0" border="0"><tr><td width="50" style="vertical-align:middle"><img src="${esc(`${base}/mail/${t.icon}.png`)}" width="40" height="40" alt="" style="display:block;border:0;width:40px;height:40px"></td><td style="vertical-align:middle;font-family:${c.font}"><div style="font-size:15px;font-weight:600;color:${c.ink};line-height:1.25">${esc(t.label)}</div><div style="font-size:12px;color:${c.muted};line-height:1.35;margin-top:2px">${esc(t.sub)}</div></td></tr></table></a></td>`;
  return `<table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="margin:0 0 22px;border-collapse:separate"><tr><td style="padding:20px 15px 15px;border-radius:22px;background:${c.bg}"><div style="padding:0 5px"><div style="font-size:19px;font-weight:700;letter-spacing:-0.02em;color:${c.ink}">In Kalender eintragen</div><div style="margin:4px 0 12px;font-size:14px;line-height:1.5;color:${c.muted}">${esc(cal.note ?? "Mit Erinnerung 1 Tag und 2 Stunden vorher.")}</div></div><table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0"><tr>${tile(tiles[0])}${tile(tiles[1])}</tr><tr>${tile(tiles[2])}${tile(tiles[3])}</tr></table></td></tr></table>`;
}

function paragraph(text: string) {
  return `<p style="margin:0 0 16px;font-size:16px;line-height:1.65;color:#3a3a3f">${lines(text)}</p>`;
}

function quoteBox(q: { title: string; text: string; meta?: string }) {
  return `<table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="margin:0 0 22px;border-collapse:separate"><tr><td style="padding:22px 24px;border-radius:20px;background:${c.purpleTint}"><div style="font-size:12px;font-weight:700;letter-spacing:1.8px;text-transform:uppercase;color:${c.purple}">${esc(q.title)}</div>${q.meta ? `<div style="margin:8px 0 0;font-size:15px;font-weight:600;color:${c.ink}">${esc(q.meta)}</div>` : ""}<p style="margin:10px 0 0;font-size:16px;line-height:1.6;color:${c.ink}">${lines(q.text)}</p></td></tr></table>`;
}

function body(m: Mail2026, assetBase: string) {
  const parts: string[] = [];
  if (m.greeting)
    parts.push(
      `<p style="margin:0 0 14px;font-size:17px;line-height:1.6;font-weight:600;color:${c.ink}">${esc(m.greeting)}</p>`,
    );
  for (const p of m.paragraphs ?? []) parts.push(paragraph(p));
  const flow = m.flow ?? [];
  for (let i = 0; i < flow.length; i++) {
    const item = flow[i];
    if (item.type === "p") parts.push(paragraph(item.text));
    else if (item.type === "quote") parts.push(quoteBox(item));
    else {
      const group: MailFact[] = [];
      while (i < flow.length && flow[i].type === "fact") {
        const f = flow[i] as Extract<MailFlowItem, { type: "fact" }>;
        group.push({ label: f.label, value: f.value, tone: f.tone });
        i++;
      }
      i--;
      parts.push(facts({ facts: group }));
    }
  }
  if (m.facts?.length) parts.push(`<div style="height:6px"></div>${facts(m)}`);
  if (m.calendar) parts.push(calendar(m.calendar, assetBase));
  if (m.list)
    parts.push(
      `<h2 style="margin:4px 0 8px;font-size:19px;font-weight:700;letter-spacing:-0.02em;color:${c.ink}">${esc(m.list.title)}</h2><table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="margin:0 0 22px">${m.list.items
        .map(
          (item) =>
            `<tr><td width="34" style="padding:7px 0;vertical-align:top"><div style="width:26px;height:26px;line-height:26px;border-radius:50%;background:${c.limeTint};color:#3f8f00;text-align:center;font-size:14px;font-weight:700">&#10003;</div></td><td style="padding:7px 0;font-size:15px;line-height:26px;color:${c.ink}">${esc(item)}</td></tr>`,
        )
        .join("")}</table>`,
    );
  if (m.quote) parts.push(quoteBox(m.quote));
  if (m.rating)
    parts.push(
      `<table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="margin:0 0 22px;border-collapse:separate"><tr><td style="padding:24px 20px;border-radius:20px;background:${c.bg};text-align:center"><h2 style="margin:0;font-size:20px;font-weight:700;letter-spacing:-0.02em;color:${c.ink}">${esc(m.rating.title)}</h2><p style="margin:8px 0 16px;font-size:14px;line-height:1.5;color:${c.muted}">${lines(m.rating.text)}</p><table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0"><tr>${m.rating.urls
        .map(
          (url, i) =>
            `<td width="20%" style="padding:0 4px"><a href="${esc(url)}" class="m-star" style="display:block;padding:14px 0;border-radius:16px;background:${i === 4 ? c.lime : "#ffffff"};border:1px solid ${i === 4 ? c.lime : c.hair};color:${c.ink};font-size:18px;font-weight:700;text-decoration:none;text-align:center">${i + 1}&nbsp;<span style="color:${i === 4 ? c.ink : c.purple}">&#9733;</span></a></td>`,
        )
        .join(
          "",
        )}</tr></table><p style="margin:14px 0 0;font-size:12px;line-height:1.5;color:${c.muted}">1 = nicht zufrieden &middot; 5 = sehr zufrieden</p></td></tr></table>`,
    );
  if (m.secondary?.length && m.calloutAfterActions) parts.push(actions(m));
  if (m.callout) {
    const tone = m.callout.tone ?? "lime";
    const bg =
      tone === "lime" ? c.limeTint : tone === "purple" ? c.purpleTint : c.bg;
    const accent =
      tone === "lime" ? "#3f8f00" : tone === "purple" ? c.purple : c.muted;
    parts.push(
      `<table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="margin:0 0 22px;border-collapse:separate"><tr><td style="padding:18px 20px;border-radius:18px;background:${bg}">${m.callout.title ? `<div style="font-size:15px;font-weight:700;color:${accent};margin:0 0 6px">${esc(m.callout.title)}</div>` : ""}<div style="font-size:15px;line-height:1.6;color:${c.ink}">${lines(m.callout.text)}</div></td></tr></table>`,
    );
  }
  if (m.attachment)
    parts.push(
      `<table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="margin:0 0 22px;border-collapse:separate"><tr><td style="padding:16px 18px;border-radius:18px;border:1px solid ${c.hair}"><table role="presentation" cellspacing="0" cellpadding="0" border="0"><tr><td width="56" style="vertical-align:middle"><div style="width:44px;height:44px;line-height:44px;border-radius:12px;background:${c.lime};color:${c.limeInk};text-align:center;font-size:12px;font-weight:800;letter-spacing:0.5px">PDF</div></td><td style="vertical-align:middle"><div style="font-size:15px;font-weight:600;color:${c.ink}">${esc(m.attachment.name)}</div><div style="font-size:13px;color:${c.muted};margin-top:2px">${esc(m.attachment.note)}</div></td></tr></table></td></tr></table>`,
    );
  if (m.secondary?.length && !m.calloutAfterActions) parts.push(actions(m));
  for (const f of m.fineprint ?? [])
    parts.push(
      `<p style="margin:0 0 10px;font-size:13px;line-height:1.6;color:${c.muted}">${lines(f)}</p>`,
    );
  parts.push(MAIL_EXTRA_SLOT);
  parts.push(
    `<p style="margin:22px 0 0;font-size:16px;line-height:1.5;color:${c.ink}">${esc(m.signature ?? "Dein ProAcademy-Team")}</p>`,
  );
  return `<tr><td class="m-pad-x" style="padding:16px 20px 0">
<table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" bgcolor="#ffffff" style="border-collapse:separate;border-radius:28px;background:#ffffff">
<tr><td class="m-body" style="padding:32px 36px;font-family:${c.font};color:${c.ink}">${parts.join("\n")}</td></tr></table></td></tr>`;
}

function support(m: Mail2026) {
  if (!m.support) return "";
  const links = [
    m.support.whatsapp
      ? `<a href="${esc(m.support.whatsapp)}" style="color:${c.lime};font-weight:700;text-decoration:none">WhatsApp öffnen &#8599;</a>`
      : "",
    m.support.email
      ? `<a href="mailto:${esc(m.support.email)}" style="color:#d8c7ff;font-weight:600;text-decoration:none">${esc(m.support.email)}</a>`
      : "",
  ]
    .filter(Boolean)
    .map((link) => `<div style="margin:0 0 6px;white-space:nowrap">${link}</div>`)
    .join("");
  return `<tr><td class="m-pad-x" style="padding:16px 20px 0"><table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" bgcolor="#191433" style="border-collapse:separate;border-radius:24px;background-color:#191433;background-image:linear-gradient(135deg,#2a1f55 0%,#141826 100%)"><tr><td style="padding:24px 28px;font-family:${c.font}"><div style="font-size:18px;font-weight:700;color:#ffffff;letter-spacing:-0.01em">Wir sind für dich da.</div><div style="margin:6px 0 14px;font-size:14px;line-height:1.5;color:#b9bac6">Fragen zum Training, zu Terminen oder Buchungen? Schreib unserem Team.</div><div style="font-size:15px">${links}</div></td></tr></table></td></tr>`;
}

export function renderMail2026(m: Mail2026, opts: { assetBase?: string } = {}) {
  const base = opts.assetBase ?? "https://portal.proacademy-ak.com";
  const logo = `${base}/brand/logo-neon.png`;
  return `<!doctype html>
<html lang="de"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="color-scheme" content="light only"><meta name="supported-color-schemes" content="light"><title>${esc(m.title)}</title>
<style>
body{margin:0;padding:0;-webkit-text-size-adjust:100%}
a{text-decoration:none}
@media (max-width:620px){
 .m-pad-x{padding-left:10px!important;padding-right:10px!important}
 .m-hero{padding:26px 22px 24px!important}
 .m-body{padding:26px 22px!important}
 .m-title{font-size:29px!important}
 .m-time{font-size:44px!important}
 .m-stat{font-size:48px!important}
 .m-code{font-size:24px!important;letter-spacing:4px!important}
 .m-digit{width:44px!important}
 .m-digit div{width:40px!important;height:54px!important;line-height:54px!important;font-size:27px!important}
 .m-fact-l,.m-fact-v{font-size:14px!important}
 .m-star{font-size:15px!important;padding:12px 0!important}
 .m-cal a{padding:10px 8px!important}
 .m-cal td[width="50"]{width:44px!important}
}
</style></head>
<body style="margin:0;padding:0;background:${c.bg}">
<div style="display:none;max-height:0;overflow:hidden;opacity:0;color:${c.bg}">${esc(m.preheader)}&#847;&zwnj;&nbsp;&#847;&zwnj;&nbsp;&#847;&zwnj;&nbsp;</div>
<table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" bgcolor="${c.bg}" style="background:${c.bg}"><tr><td align="center" style="padding:24px 0 36px">
<table role="presentation" width="600" cellspacing="0" cellpadding="0" border="0" style="width:100%;max-width:600px">
<tr><td class="m-pad-x" style="padding:0 24px 18px"><table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0"><tr>
<td style="vertical-align:middle"><table role="presentation" cellspacing="0" cellpadding="0" border="0"><tr><td width="50" style="vertical-align:middle"><div style="width:42px;height:42px;border-radius:12px;background:${c.night};text-align:center"><img src="${esc(logo)}" width="26" height="31" alt="ProAcademy" style="display:inline-block;border:0;width:26px;height:31px;margin-top:5px"></div></td><td style="vertical-align:middle;font-family:${c.font}"><div style="font-size:15px;font-weight:700;letter-spacing:-0.01em;color:${c.ink}">ProAcademy</div><div style="font-size:10px;letter-spacing:2px;color:${c.muted}">BY AYHAN &amp; KARAMAN</div></td></tr></table></td>
<td align="right" style="vertical-align:middle;font-family:${c.font}"><span style="display:inline-block;padding:7px 12px;border-radius:999px;background:#ffffff;border:1px solid ${c.hair};font-size:12px;font-weight:600;color:${c.muted}">${esc(m.area)}</span></td>
</tr></table></td></tr>
${hero(m)}
${body(m, base)}
${support(m)}
<tr><td class="m-pad-x" style="padding:26px 34px 0;font-family:${c.font}">
<div style="font-size:22px;line-height:1;font-weight:800;font-style:italic;letter-spacing:-0.04em;color:#c7c7cc">BUILT. NOT BORN.</div>
<p style="margin:14px 0 0;font-size:12px;line-height:1.7;color:${c.muted}">ProAcademy by Ayhan &amp; Karaman<br><a href="mailto:contact@proacademy-ak.com" style="color:${c.muted};text-decoration:underline">contact@proacademy-ak.com</a> &middot; <a href="tel:+4915143342392" style="color:${c.muted};text-decoration:underline">+49 151 433 423 92</a><br><a href="https://proacademy-ak.com/datenschutz" style="color:${c.muted};text-decoration:underline">Datenschutz</a> &middot; <a href="https://portal.proacademy-ak.com/impressum" style="color:${c.muted};text-decoration:underline">Impressum</a></p>
</td></tr>
</table></td></tr></table>
</body></html>`;
}

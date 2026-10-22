import { escapeHtml } from "../mail";
export function trialEmailDesign(input: {
  title: string;
  text: string;
  access: string;
  actions: { label: string; url: string }[];
  ratingLinks?: string[];
  customerNotice?: boolean;
}) {
  const e = escapeHtml;
  const paragraphs = input.text
    .split("\n")
    .filter(
      (line) =>
        line.trim() &&
        !/^https?:/.test(line.trim()) &&
        !line.includes(input.access) &&
        ![
          "Euer ProAcademy-Team",
          "contact@proacademy-ak.com",
          "+49 151 433 423 92",
        ].includes(line.trim()),
    );
  const logo = new URL("/brand/logo-neon.png", input.access).href;
  return `<!doctype html><html lang="de"><head><meta name="viewport" content="width=device-width,initial-scale=1"></head><body style="margin:0;background:#eef3f4;color:#192b32;font-family:Arial,sans-serif"><div style="display:none;max-height:0;overflow:hidden">${e(input.title)} · Persönliche Begleitung für euer Kind</div><table role="presentation" width="100%" cellspacing="0" cellpadding="0"><tr><td align="center" style="padding:28px 12px"><table role="presentation" width="600" cellspacing="0" cellpadding="0" style="width:100%;max-width:600px;background:white;border-radius:22px;overflow:hidden"><tr><td style="padding:28px 32px;background:#0b171c;color:white"><img src="${e(logo)}" width="58" alt="ProAcademy" style="display:block;margin-bottom:16px"><div style="font-size:11px;letter-spacing:3px;color:#97e9e5">BY AYHAN &amp; KARAMAN</div><p style="font-size:13px;margin:12px 0 0">DEIN SPIEL. DEINE ENTWICKLUNG.</p></td></tr><tr><td style="padding:32px;background:#97e9e5"><div style="font-size:11px;font-weight:bold;letter-spacing:2px">${input.customerNotice ? "EUER TRAINING" : "EUER PROBETRAINING"}</div><h1 style="font-size:28px;line-height:1.2;margin:12px 0 0;color:#143a3a">${e(input.title)}</h1></td></tr><tr><td style="padding:26px 32px">${paragraphs.map((line, i) => `<p style="font-size:${i === 0 ? 18 : 15}px;line-height:1.7;margin:0 0 16px;${line.startsWith("Bewertung:") ? "padding:16px;background:#effaf9;border-left:4px solid #97e9e5;border-radius:8px;font-weight:bold;" : ""}">${e(line)}</p>`).join("")}${input.ratingLinks ? `<div style="padding:22px 16px;background:#f1faf9;border-radius:16px;text-align:center"><h2 style="font-size:19px;margin:0 0 10px">Wie war euer Probetraining?</h2><p style="font-size:13px;line-height:1.5">Ein Klick speichert eure Bewertung.<br>1 = nicht zufrieden · 5 = sehr zufrieden</p><table role="presentation" width="100%" cellspacing="4"><tr>${input.ratingLinks.map((url, i) => `<td align="center" style="background:#97e9e5;border-radius:8px"><a href="${e(url)}" style="display:block;padding:14px 3px;color:#143a3a;font-size:18px;font-weight:bold;text-decoration:none">${i + 1} ★</a></td>`).join("")}</tr></table><p style="font-size:12px;line-height:1.5">Nach dem Klick seht ihr eure gespeicherten Sterne und könnt einmalig eine persönliche Nachricht ergänzen.</p></div>` : ""}<p style="margin:24px 0"><a href="${e(input.access)}" style="display:inline-block;padding:15px 23px;border-radius:10px;background:#142d33;color:#fff;text-decoration:none;font-size:15px;font-weight:bold">${input.customerNotice ? "Euer Trainingsportal" : "Euer Willkommensportal"} →</a></p>${input.actions
    .filter((a) => a.url !== input.access)
    .map(
      (a) =>
        `<p><a href="${e(a.url)}" style="color:#174d4c;font-weight:bold;text-decoration:underline">${e(a.label)} →</a></p>`,
    )
    .join(
      "",
    )}<div style="border-top:1px solid #dce8e7;padding-top:22px;margin-top:28px"><h2 style="font-size:17px;margin:0 0 10px">Mit Freude wachsen. Gemeinsam besser werden.</h2><p style="font-size:13px;line-height:1.7;margin:0;color:#506166">Wir begleiten Kinder persönlich – mit Respekt, klaren nächsten Schritten und Freude am Fußball. Eure Fragen und Rückmeldungen gehören dazu.</p></div></td></tr><tr><td style="padding:22px 32px;background:#edf4f3;font-size:12px;line-height:1.8;color:#405b5b">ProAcademy by Ayhan &amp; Karaman<br><a href="mailto:contact@proacademy-ak.com" style="color:#174d4c">contact@proacademy-ak.com</a> · <a href="tel:+4915143342392" style="color:#174d4c">+49 151 433 423 92</a><br><a href="https://proacademy-ak.com/datenschutz" style="color:#174d4c">Datenschutz</a></td></tr></table></td></tr></table></body></html>`;
}

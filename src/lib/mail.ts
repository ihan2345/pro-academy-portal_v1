import nodemailer from "nodemailer";
export interface Email {
  to: string;
  subject: string;
  text: string;
  html: string;
  messageId: string;
  attachments?: { filename: string; content: Buffer; contentType: string }[];
}
export interface MailProvider {
  name: string;
  send(mail: Email): Promise<{ id: string }>;
}
export class CaptureProvider implements MailProvider {
  name = "capture";
  sent: Email[] = [];
  constructor(private persist?: (mail: Email) => Promise<void>) {}
  async send(mail: Email) {
    this.sent.push(mail);
    if (this.persist) await this.persist(mail);
    return { id: mail.messageId };
  }
}
export class ProtonProvider implements MailProvider {
  name = "proton";
  async send(mail: Email) {
    if (process.env.CAMP_SIDE_EFFECTS_BLOCKED === "true")
      throw new Error("Versand im lokalen Camp-Test gesperrt");
    const {
      PROTON_SMTP_HOST,
      PROTON_SMTP_PORT,
      PROTON_SMTP_USER,
      PROTON_SMTP_TOKEN,
      EMAIL_FROM,
    } = process.env;
    if (
      !PROTON_SMTP_HOST ||
      !PROTON_SMTP_USER ||
      !PROTON_SMTP_TOKEN ||
      !EMAIL_FROM
    )
      throw new Error("SMTP-Konfiguration unvollständig");
    const transport = nodemailer.createTransport({
      host: PROTON_SMTP_HOST,
      port: Number(PROTON_SMTP_PORT ?? 587),
      secure: false,
      requireTLS: true,
      auth: { user: PROTON_SMTP_USER, pass: PROTON_SMTP_TOKEN },
      connectionTimeout: 15000,
      greetingTimeout: 15000,
      socketTimeout: 25000,
      tls: { minVersion: "TLSv1.2", rejectUnauthorized: true },
    });
    try {
      const info = await transport.sendMail({ ...mail, from: EMAIL_FROM });
      return { id: info.messageId };
    } finally {
      transport.close();
    }
  }
}
export function safeRecipient(recipient: string) {
  if (
    process.env.APP_MODE !== "production" &&
    process.env.EMAIL_TEST_MODE === "false"
  )
    throw new Error("Echter Versand im Testbetrieb gesperrt");
  if (process.env.EMAIL_TEST_MODE !== "false") {
    const target = process.env.EMAIL_TEST_RECIPIENT;
    if (!target || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(target))
      throw new Error("Gültiger eigener Testempfänger fehlt");
    return target;
  }
  return recipient;
}
export function escapeHtml(text: string) {
  return text.replace(
    /[&<>"']/g,
    (c) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[
        c
      ]!,
  );
}
export function htmlEmail(title: string, text: string, url: string) {
  const logoUrl = new URL("/brand/logo-neon.png", url).href;
  return `<html lang="de"><body style="margin:0;background:#f5f6f8;font:16px Arial,sans-serif;color:#17202c"><div style="max-width:560px;margin:30px auto;background:white"><div style="padding:24px 28px;background:#0B0F1A;color:#8EFF01"><img src="${escapeHtml(logoUrl)}" alt="ProAcademy" width="84" height="100" style="display:block;border:0;width:84px;height:100px;object-fit:contain"><div style="margin-top:12px;font-size:10px;letter-spacing:2px;color:#c4c8c7">BY AYHAN &amp; KARAMAN</div></div><div style="padding:28px"><h1 style="font-size:22px">${escapeHtml(title)}</h1>${text
    .split("\n")
    .map((line) => `<p style="line-height:1.6">${escapeHtml(line)}</p>`)
    .join(
      "",
    )}<a href="${escapeHtml(url)}" style="display:inline-block;background:#8EFF01;color:#173000;padding:14px 20px;text-decoration:none;border-radius:5px">Zum Elternportal</a></div></div></body></html>`;
}

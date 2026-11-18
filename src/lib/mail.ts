import nodemailer from "nodemailer";
import { textMailHtml, type MailLook } from "./mail-2026/from-text";
export interface Email {
  to: string;
  subject: string;
  text: string;
  html: string;
  messageId: string;
  replyTo?: string;
  attachments?: {
    filename: string;
    content: Buffer;
    contentType: string;
    cid?: string;
  }[];
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
/** Alle Portal-Mails im Design 2026 (src/lib/mail-2026). Klartext bleibt unverändert. */
export function htmlEmail(
  title: string,
  text: string,
  url: string,
  actions: { label: string; url: string }[] = [],
  look: MailLook = {},
) {
  return textMailHtml(title, text, url, actions, look);
}

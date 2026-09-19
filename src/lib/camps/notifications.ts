import "server-only";
import { serviceDb } from "@/lib/server/service-db";
import { formatDate, formatTime } from "@/lib/domain";
import { htmlEmail, safeRecipient, type Email } from "@/lib/mail";
import { campProcessingEnabled } from "./processing-config";
export const CAMP_MAIL_KINDS = [
  "camp_booking_confirmation",
  "camp_reminder_7d",
  "camp_reminder_24h",
  "camp_completion",
];
export class CampMailHeld extends Error {}
export async function requireCampMailRecipient(job: Record<string, unknown>) {
  const r = await serviceDb().rpc("parent_delivery_allowed", {
    recipient: String(job.recipient),
    kind: String(job.kind),
    payload: job.payload,
  });
  if (r.error) throw r.error;
  if (!r.data)
    throw new CampMailHeld(
      "Camp-Mail nicht mehr fällig oder Teilnahme/Empfänger nicht freigegeben.",
    );
}
export async function planCampMail() {
  if (!campProcessingEnabled()) return 0;
  const r = await serviceDb().rpc("camp_plan_notifications");
  if (r.error) throw r.error;
  return Number(r.data);
}
type CampMailData = {
  title: string;
  location: string;
  days: { starts_at: string; ends_at: string }[];
  child: string;
  report?: string;
  payment?: {
    offerPrice: number;
    paid: number;
    currency: string;
    earlyBird: boolean;
  };
};
export function campMailContent(
  kind: string,
  data: CampMailData,
  bookingId: string,
  whatsapp: string,
) {
  const completed = kind === "camp_completion";
  const booked = kind === "camp_booking_confirmation";
  const subject = booked
    ? `Buchungsbestätigung: ${data.title} für ${data.child}`
    : completed
      ? `Camp-Teilnahme bestätigt: ${data.child}`
      : `${kind === "camp_reminder_7d" ? "Camp-Erinnerung" : "Letzte Camp-Erinnerung"}: ${data.title} für ${data.child}`;
  const days = [...data.days].sort((a, b) =>
    a.starts_at.localeCompare(b.starts_at),
  );
  const text = [
    "Hallo,",
    booked
      ? `die Zahlung ist bestätigt und der Camp-Platz für ${data.child} beim ${data.title} ist gebucht.`
      : completed
        ? `die Teilnahme von ${data.child} am ${data.title} ist bestätigt. Hier findest du die Zusammenfassung des Camps:`
        : `wir freuen uns auf ${data.child} beim ${data.title}. Hier findest du die wichtigsten Angaben:`,
    `Ort: ${data.location}`,
    ...days.map(
      (d) =>
        `${formatDate(d.starts_at)} · ${formatTime(d.starts_at)}–${formatTime(d.ends_at)} Uhr`,
    ),
    "Alle Uhrzeiten gelten für Deutschland (Europe/Berlin).",
    ...(booked ? bookingPriceLines(data.payment) : []),
    ...(booked ? [`Buchungsnummer: ${bookingId}`] : []),
    ...(completed && data.report ? ["Camp-Bericht:", data.report] : []),
    completed
      ? "Fragen oder eine Angabe stimmt nicht? Melde dich direkt bei unserem Team."
      : "Änderungen oder Fragen zur Teilnahme? Melde dich direkt bei unserem Team.",
  ].join("\n");
  const message = `Hallo ProAcademy-Team, ich habe eine Frage/Änderung zu ${data.child}, ${data.title} (Start ${formatDate(days[0].starts_at)}). Buchung: ${bookingId}.`;
  const actions = [
    ...(whatsapp.replace(/\D/g, "")
      ? [
          {
            label: "Per WhatsApp kontaktieren",
            url: `https://wa.me/${whatsapp.replace(/\D/g, "")}?text=${encodeURIComponent(message)}`,
          },
        ]
      : []),
    {
      label: "Per E-Mail kontaktieren",
      url: `mailto:mail@proacademy-ak.com?subject=${encodeURIComponent(`${data.title} · ${data.child}`)}&body=${encodeURIComponent(message)}`,
    },
  ];
  return { subject, text, actions };
}
function bookingPriceLines(payment: CampMailData["payment"]) {
  if (
    !payment ||
    !Number.isSafeInteger(payment.offerPrice) ||
    !Number.isSafeInteger(payment.paid) ||
    payment.offerPrice < 0 ||
    payment.paid < 0 ||
    payment.paid > payment.offerPrice
  )
    throw new Error(
      "Bestätigte Camp-Zahlungsbeträge fehlen oder sind unplausibel.",
    );
  const money = (cents: number) =>
    new Intl.NumberFormat("de-DE", {
      style: "currency",
      currency: payment.currency.toUpperCase(),
    }).format(cents / 100);
  const discount = payment.offerPrice - payment.paid;
  return [
    `${payment.earlyBird ? "Frühbucherpreis (bereits reduziert)" : "Gebuchter Camp-Preis"}: ${money(payment.offerPrice)}`,
    discount > 0
      ? `Zusätzlicher Rabatt bei der Zahlung: −${money(discount)}`
      : "Kein zusätzlicher Rabatt bei der Zahlung.",
    `Bezahlt: ${money(payment.paid)}`,
  ];
}
export async function composeCampMail(
  job: Record<string, unknown>,
): Promise<Email> {
  const db = serviceDb(),
    payload = job.payload as { booking_id: string };
  const b = await db
    .from("camp_bookings")
    .select(
      "id,camp_id,offer_id,child_data,expected_amount,paid_amount,currency",
    )
    .eq("id", payload.booking_id)
    .single();
  if (b.error) throw b.error;
  const [c, r] = await Promise.all([
    db
      .from("camps")
      .select("title,location,days")
      .eq("id", b.data.camp_id)
      .single(),
    db
      .from("camp_reports")
      .select("content")
      .eq("booking_id", b.data.id)
      .eq("visible_to_parent", true)
      .maybeSingle(),
  ]);
  if (c.error) throw c.error;
  if (r.error) throw r.error;
  let payment: CampMailData["payment"];
  if (job.kind === "camp_booking_confirmation") {
    const offer = await db
      .from("camp_offers")
      .select("kind")
      .eq("id", b.data.offer_id)
      .single();
    if (offer.error) throw offer.error;
    payment = {
      offerPrice: b.data.expected_amount,
      paid: b.data.paid_amount,
      currency: b.data.currency,
      earlyBird: offer.data.kind === "early",
    };
  }
  const content = campMailContent(
    String(job.kind),
    {
      ...c.data,
      child: `${b.data.child_data.first_name} ${b.data.child_data.last_name}`,
      report: r.data?.content,
      payment,
    },
    b.data.id,
    process.env.WHATSAPP_NUMBER ?? "",
  );
  const url = `${process.env.APP_URL}/camps/${b.data.camp_id}`;
  return {
    to:
      process.env.MAIL_PROVIDER === "capture"
        ? String(job.recipient)
        : safeRecipient(String(job.recipient)),
    subject: content.subject,
    text: `${content.text}\n${content.actions.map((a) => `${a.label}: ${a.url}`).join("\n")}\nZum Elternportal: ${url}`,
    html: htmlEmail(content.subject, content.text, url, content.actions),
    replyTo: "mail@proacademy-ak.com",
    messageId: `<${job.id}@proacademy-portal.local>`,
  };
}

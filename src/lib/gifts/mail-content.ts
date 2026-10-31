import "server-only";
import { htmlEmail } from "@/lib/mail";
import { giftMoney } from "./domain";
import { giftExpiry } from "./artwork";
import { giftMailImages } from "./artwork-mail";
export type GiftMailKind =
  "buyer" | "recipient" | "balance" | "status_buyer" | "status_recipient";
export function giftMailContent({
  kind,
  order,
  gift,
  url,
  code,
  event,
  purchase,
}: {
  kind: GiftMailKind;
  order: any;
  gift: any;
  url: string;
  code?: string;
  event?: any;
  purchase?: any;
}) {
  let subject: string, text: string;
  const date = gift?.expires_at ? giftExpiry(gift.expires_at) : "";
  if (kind.startsWith("status_")) {
    subject = "Dein persönlicher ProAcademy Bestellstatus";
    text = [
      `Hallo ${kind === "status_buyer" ? order.buyer.full_name : order.recipient.first_name},`,
      "du hast deinen persönlichen Statuslink erneut angefordert.",
      kind === "status_buyer"
        ? "Über diesen Link findest du Kaufbestätigung und Zahlungsstatus deiner Geschenkkartenbestellung."
        : "Über diesen Link findest du deinen aktuellen Geschenkcode, Restbetrag und deine Guthaben-Historie.",
      "Du benötigst dafür kein Portalkonto. Bewahre den Link auf: Wer ihn besitzt, kann die für dich freigegebenen Informationen sehen.",
      `Bestellnummer: ${order.id}`,
    ].join("\n");
  } else if (kind === "balance") {
    subject = `Dein ProAcademy Geschenkguthaben: noch ${giftMoney(event.after_balance)}`;
    text = [
      `Hallo ${order.recipient.first_name},`,
      "durch deinen letzten Kauf mit der ProAcademy Geschenkkarte hat sich dein Guthaben geändert.",
      `Guthaben davor: ${giftMoney(event.before_balance)}`,
      `Bei diesem Kauf eingesetzt: ${giftMoney(event.used_amount)}`,
      `Dein Restbetrag nach diesem Kauf: ${giftMoney(event.after_balance)}`,
      `Letzter Kauf: ${purchase.product.name}`,
      `Bestell-ID des Kaufs: ${purchase.id}`,
      `Einlösung am: ${new Intl.DateTimeFormat("de-DE", { timeZone: "Europe/Berlin", dateStyle: "medium", timeStyle: "short" }).format(new Date(event.purchased_at))}`,
      `Bestellwert nach Preisvorteilen: ${giftMoney(purchase.expected_amount + purchase.gift_credit_amount)}`,
      `Zusätzlich gezahlt: ${giftMoney(purchase.expected_amount)}`,
      `Dein neuer Geschenkcode: ${code}`,
      "Der vorherige Code wurde ersetzt. Nutze ab jetzt diesen Code für deinen Restbetrag. Nach jeder weiteren erfolgreichen Einlösung erhält der verbleibende Wert wieder einen neuen Code.",
      `Gültig bis: ${date} – die ursprüngliche Gültigkeit seit dem ersten Erwerb bleibt bestehen.`,
      "Unter Bestellstatus findest du jederzeit den aktuellen Stand und die vollständige Guthaben-Historie. Falls du inzwischen erneut eingekauft hast, gilt der dort angezeigte neueste Code.",
      `Geschenkkarten-Bestellnummer: ${order.id}`,
    ].join("\n");
  } else {
    const buyer = kind === "buyer",
      current = gift.remaining ?? gift.amount;
    subject = buyer
      ? "Deine ProAcademy Geschenkkarte – Kauf bestätigt"
      : `${order.buyer.full_name} schenkt dir ProAcademy`;
    text = [
      `Hallo ${buyer ? order.buyer.full_name : order.recipient.first_name},`,
      buyer
        ? `Dein Kauf über ${giftMoney(order.amount)} ist bestätigt. Die Geschenkbenachrichtigung wird separat an ${order.recipient.email} zugestellt.`
        : `${order.buyer.full_name} hat dir eine ProAcademy Geschenkkarte über ${giftMoney(gift.amount)} gekauft.`,
      ...(!buyer && current !== gift.amount
        ? [`Aktuell verbliebenes Guthaben: ${giftMoney(current)}`]
        : []),
      ...(buyer || current > 0
        ? [
            `Dein ${buyer ? "ursprünglicher Geschenkcode" : "aktueller Geschenkcode"}: ${code}`,
          ]
        : [
            "Dein Geschenk ist bereits vollständig eingelöst. Die bisherigen Vorgänge findest du in deiner Guthaben-Historie.",
          ]),
      `Einlösbar bis ${date}.`,
      buyer
        ? "Dein persönlicher Bestellstatus zeigt dir Kaufbestätigung und Zahlungsstatus. Die beschenkte Person erhält einen eigenen Link für Gutschein, Restguthaben und Verbrauchshistorie."
        : "Gib den Geschenkcode im Shop direkt beim Checkout ein. Ein gesondertes Gutscheinkonto ist nicht nötig. Nach jedem erfolgreichen Einsatz wird der bisherige Code gesperrt; für verbleibendes Guthaben erhältst du einen neuen Code.",
      ...(!buyer
        ? [
            "Über deinen persönlichen Statuslink kannst du jederzeit den aktuellen Code, das Restguthaben und die Guthaben-Historie ansehen – ohne Portalanmeldung. Bewahre diesen Link auf.",
          ]
        : []),
      "Gültig für neue Shopangebote einschließlich der ersten Abo-Zahlung. Frühbucher- und Abo-Vorteile werden zuerst berücksichtigt. Weitere Abo-Zahlungen werden regulär berechnet. Ein Kauf weiterer Geschenkkarten aus Guthaben ist ausgeschlossen.",
      `Angebote: ${new URL("/produkte", process.env.APP_URL!).href}`,
      "ProAcademy begleitet Kinder und Familien im Fußballtraining. Im Elternportal verwaltest du deine Buchungen und Trainingsangebote.",
      `Bestellnummer: ${order.id}`,
    ].join("\n");
  }
  return {
    subject,
    text: `${text}\n${url}`,
    html: htmlEmail(subject, text, url).replace(
      ">Zum Elternportal</a>",
      ">Bestellstatus ansehen</a>",
    ),
  };
}
export function withGiftImages(html: string) {
  return html.replace(
    "</div></div></body>",
    `${giftMailImages}</div></div></body>`,
  );
}

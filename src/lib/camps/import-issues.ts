/** Only business validation reaches the review UI; infrastructure errors stay generic. */
export function campImportIssue(message: string) {
  const labels: Record<string, string> = {
    "Capacity reached": "Camp ist ausgebucht. Bitte die Kapazität prüfen.",
    "Child already booked":
      "Dieses Kind ist bereits für das Camp gebucht. Bitte die weitere Zahlung prüfen.",
    "Existing contact: select family instead":
      "Elternkontakt bereits vorhanden. Bitte die vorhandene Familie auswählen.",
    "Stripe customer already assigned":
      "Stripe-Kunde ist bereits einer anderen Familie zugeordnet. Bitte prüfen.",
    "Family link missing":
      "Eltern-Kind-Zuordnung fehlt. Bitte die Familie prüfen.",
    "Child missing":
      "Kind fehlt oder ist archiviert. Bitte die Zuordnung prüfen.",
    "Child details missing":
      "Kindesname oder Kleidergröße fehlen. Bitte Angaben ergänzen.",
    "Invalid verified payment":
      "Zahlungsprüfung fehlgeschlagen. Bitte die Zahlung prüfen.",
    "Payment already assigned differently":
      "Diese Zahlung ist bereits anders zugeordnet. Bitte die Buchung prüfen.",
  };
  return (
    labels[message] ??
    (/^(Sonderrabatt|Alter|Altersgrenze|Bekanntes Geburtsdatum|Geburtsdatum|Campbeginn|Gespeicherter Prüfentwurf|Familie|Elternname|Kind|Aktive Familie|Vorhandene Familie)/.test(
      message,
    )
      ? message
      : "Übernahme abgelehnt. Zuordnung, Zahlung und Kapazität prüfen.")
  );
}

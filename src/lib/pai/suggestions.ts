export function paiSuggestions(role: string): string[] {
  if (role === "parent")
    return [
      "Wie viele Trainingseinheiten haben meine Kinder noch?",
      "Wann war das letzte Training meiner Kinder?",
      "Wie oft haben meine Kinder diesen Monat trainiert?",
      "Warum haben wir dieses Abzeichen?",
    ];
  if (role === "admin")
    return [
      "Wie viele Spieler haben ein aktives Abo?",
      "Welche Leistungszeiträume enden in den nächsten 30 Tagen?",
      "Welche Rechnungen sind noch offen?",
      "Welcher Standort hatte diesen Monat die meisten Trainingsstunden?",
    ];
  return [
    "Welche Spieler haben diesen Monat häufig gefehlt?",
    "Wie viele Trainingsstunden hatte jeder Trainer diesen Monat?",
    "Wer hat am letzten Training teilgenommen?",
    "Welche Leistungszeiträume enden in den nächsten 30 Tagen?",
  ];
}

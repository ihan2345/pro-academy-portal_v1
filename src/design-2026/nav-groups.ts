// Design 2026: ordnet die bestehenden Menüpunkte in Kategorien.
// Ändert weder Reihenfolge-Logik noch Rechte, nur die Überschriften im Menü.
export function navGroup(href: string, role: string): string | undefined {
  if (!href) return undefined;
  const path = href.split("?")[0];
  if (role === "parent") {
    if (["/", "/termine", "/stempelkarte", "/berichte"].includes(path))
      return "Training";
    if (["/profil", "/konto"].includes(path)) return "Familie";
    return "Entdecken";
  }
  const sub = path.replace(/^\/(admin|team)\/?/, "");
  if (["", "trainingsplanung", "probetraining", "stempelkarten"].includes(sub))
    return "Training";
  if (["elternprofile", "spielerprofile", "mitarbeiter"].includes(sub))
    return "Menschen";
  if (
    ["standorte", "einstellungen", "#verwaltung", "/konto"].includes(sub) ||
    path === "#verwaltung" ||
    path === "/konto"
  )
    return "Betrieb";
  return "Entdecken";
}

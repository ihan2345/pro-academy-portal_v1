// Design 2026: ordnet die bestehenden Menüpunkte in Kategorien.
// Ändert weder Reihenfolge-Logik noch Rechte, nur die Überschriften im Menü.
export function navGroup(href: string, role: string): string | undefined {
  if (!href) return undefined;
  const path = href.split("?")[0];
  if (role === "parent") {
    if (["/", "/termine", "/stempelkarte", "/berichte"].includes(path))
      return "Training";
    if (
      ["/profil", "/konto", "/profil/geschenkkarten", "/elternkabine"].includes(
        path,
      )
    )
      return "Familie";
    if (href.includes("kaufen=geschenkkarte")) return "Familie";
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

type NavItem = { href: string; title: string; icon: unknown; count?: number };
// Elternmenü im Design 2026: weniger, klarere Punkte. Berichte stecken jetzt in
// "Fortschritt" (gleiche Seiten, nur zusammengefasst).
const parentTitles: Record<string, string> = {
  "/": "Heute",
  "/termine": "Kalender",
  "/stempelkarte": "Fortschritt",
  "/profil": "Familie",
  "/konto": "Konto",
};
export function designNavItems<T extends NavItem>(
  items: T[],
  role: string,
): T[] {
  if (role !== "parent")
    return items.map((i) =>
      i.href === "/admin" || i.href === "/team"
        ? { ...i, title: i.href === "/admin" ? "Zentrale" : i.title }
        : i,
    );
  const hasProgress = items.some((i) => i.href === "/stempelkarte");
  return items
    .filter((i) => !(hasProgress && i.href === "/berichte"))
    .map((i) => ({ ...i, title: parentTitles[i.href] ?? i.title }));
}

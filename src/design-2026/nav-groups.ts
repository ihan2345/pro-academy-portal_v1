// Design 2026: ordnet die bestehenden Menüpunkte im Elternportal in Kategorien.
// Mitarbeiter- und Adminmenü bleiben ungruppiert.
export function navGroup(href: string, role: string): string | undefined {
  if (role !== "parent" || !href) return undefined;
  const path = href.split("?")[0];
  if (["/", "/termine", "/stempelkarte", "/berichte"].includes(path))
    return "Training";
  if (["/profil", "/konto"].includes(path)) return "Familie";
  return "Entdecken";
}

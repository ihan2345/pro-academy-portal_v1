# Design 2026 (Vorschau)

Rein optische Überarbeitung des Portals im Stil moderner Apple-/2026-Websites.
Keine Änderung an Daten, Supabase-Abfragen, Login, Zahlungen oder E-Mails.

## Was ist drin

- `design-2026.css`: neue Optik (Glas-Seitenleiste, Karten, Animationen, Handy-Tab-Leiste).
  Greift nur bei `<html data-design="2026">`.
- `nav-groups.ts`: Menü im Elternportal in Kategorien (Training, Familie, Entdecken).
- `spotlight.tsx`: Schnellsuche mit ⌘K / Strg+K, öffnet nur bestehende Menüseiten.
- `tab-bar.tsx`: Tab-Leiste unten auf dem Handy, "Mehr" öffnet das bisherige Menü.
- `mock-data.ts`, `preview-fetch.tsx` und `src/app/design-vorschau`: Vorschau mit Beispieldaten.

## Lokal ansehen

```bash
echo "DESIGN_PREVIEW=true" >> .env.local
npm run dev
# http://127.0.0.1:3000/design-vorschau, /design-vorschau/termine, /design-vorschau/camps
```

Ohne `DESIGN_PREVIEW=true` liefert `/design-vorschau` eine 404.

## Abschalten oder verwerfen

- Ganz verwerfen: Branch `claude/design-preview-2026` löschen.
- Nur ausschalten: in `src/app/layout.tsx` das Attribut `data-design="2026"` entfernen.

## Neue Ansichten (Konzept iOS)

- Eltern: „Heute“ (nächstes Training mit Kalender-Export und Route, Ringe für
  Einheiten/Einplanung/Zeitraum, Widgets für Paket, Stempelkarte, Berichte),
  „Kalender“ (Wochenleiste, Filter Anstehend/Vergangen/Alle, Suche, nach Tagen
  gruppiert) und „Fortschritt“ (Stempelkarte und Berichte in einer Ansicht).
- Admin: „Zentrale“ mit Kennzahlen, „Heute auf dem Platz“, Wochenauslastung,
  Schnellzugriff und dem bestehenden Stripe-/Abo-Posteingang.
- Schalter: `src/design-2026/flag.ts` (`DESIGN_2026 = false` stellt alles zurück).

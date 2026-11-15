"use client";
// Design-Vorschau 2026: beantwortet Portal-Anfragen der Vorschau im Browser mit
// Beispieldaten, damit ohne Login und ohne Supabase nichts geladen oder gespeichert wird.
import { previewAdminRows, previewCamps } from "./mock-data";
import { previewFamily, previewGifts, previewProducts } from "./mock-pages";

if (
  typeof window !== "undefined" &&
  location.pathname.startsWith("/design-vorschau")
) {
  const original = window.fetch.bind(window);
  window.fetch = async (input, init) => {
    const url =
      typeof input === "string"
        ? input
        : input instanceof URL
          ? input.href
          : input.url;
    const path = new URL(url, location.origin).pathname;
    if (path === "/api/camp/dashboard") return Response.json(previewCamps());
    if (path === "/api/account/email-preference")
      return Response.json({ enabled: true });
    if (path === "/api/products" && (!init?.method || init.method === "GET"))
      return Response.json(previewProducts());
    if (path === "/api/products/gifts/mine")
      return Response.json(previewGifts());
    if (/^\/api\/parent-profiles\/[^/]+\/units$/.test(path))
      return Response.json({
        units: previewFamily("parent").units,
        more: false,
      });
    if (/^\/api\/parent-profiles\/[^/]+\/finances$/.test(path))
      return Response.json(
        { error: "Finanzen sind in der Vorschau nicht verfügbar." },
        { status: 404 },
      );
    const table = path.match(/^\/api\/admin\/([a-z_]+)$/)?.[1];
    if (table && (!init?.method || init.method === "GET"))
      return Response.json({ rows: previewAdminRows(table) });
    if (path.startsWith("/api/"))
      return Response.json({
        ok: true,
        preview: true,
        rows: [],
        total: 0,
        openCount: 0,
        checkedAt: new Date().toISOString(),
        now: new Date().toISOString(),
      });
    return original(input, init);
  };
}

// Links im Menü führen in der Vorschau auf die passende Vorschau-Seite statt
// auf die echte (die einen Login bräuchte).
const previewable =
  /^\/(termine|stempelkarte|berichte|konto|profil|produkte|profil\/geschenkkarten|camps(\/[0-9a-f-]+)?|admin(\/(spieler|eltern|standorte|mitarbeiter|trainingsplanung))?)?$/;
if (
  typeof window !== "undefined" &&
  location.pathname.startsWith("/design-vorschau")
)
  document.addEventListener(
    "click",
    (event) => {
      const link = (event.target as Element | null)?.closest?.("a[href]");
      const href = link?.getAttribute("href") ?? "";
      const path = href.split("?")[0];
      if (!href.startsWith("/") || href.startsWith("/design-vorschau")) return;
      if (!previewable.test(path)) return;
      event.preventDefault();
      event.stopPropagation();
      location.assign("/design-vorschau" + (path === "/" ? "" : path));
    },
    true,
  );

export function PreviewFetch() {
  return null;
}

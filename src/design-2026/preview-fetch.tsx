"use client";
// Design-Vorschau 2026: beantwortet Portal-Anfragen der Vorschau im Browser mit
// Beispieldaten, damit ohne Login und ohne Supabase nichts geladen oder gespeichert wird.
import {
  previewAdminRows,
  previewCampCustomers,
  previewCamps,
} from "./mock-data";
import {
  previewActivities,
  previewConflicts,
  previewFamily,
  previewGifts,
  previewParentList,
  previewPlayerProfiles,
  previewPlayerArchive,
  previewTrialArchive,
  previewProducts,
  previewTrials,
  previewTrialPastEvents,
  previewTrialNotices,
} from "./mock-pages";

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
    if (path === "/api/camp/customers")
      return Response.json(previewCampCustomers());
    // Vorschau: gemeinsames Merken ist "noch nicht eingerichtet", der
    // Browser merkt Markierungen lokal.
    if (path === "/api/notice-decisions")
      return init?.method === "POST"
        ? Response.json({ error: "Vorschau" }, { status: 503 })
        : Response.json({ available: false, rows: [] });
    if (path === "/api/pai/history") return Response.json({ messages: [] });
    if (path === "/api/pai/status")
      return Response.json({
        enabled: true,
        available: false,
        reason: "PAiLTON antwortet in der Vorschau nicht.",
        limit: 0,
        used: 0,
        reserved: 0,
        remaining: 0,
        reset: new Date().toISOString(),
        override: false,
        retentionDays: 30,
      });
    if (path === "/api/platform/availability")
      return Response.json({ pai: true, mascot: true });
    if (path === "/api/account/email-preference")
      return Response.json({ enabled: true });
    if (path === "/api/products" && (!init?.method || init.method === "GET"))
      return Response.json(previewProducts());
    if (path === "/api/player-archive")
      return Response.json(previewPlayerArchive());
    if (path === "/api/player-archive/trials")
      return Response.json(previewTrialArchive());
    if (path === "/api/player-profiles")
      return Response.json(previewPlayerProfiles());
    if (path === "/api/parent-profiles/list")
      return Response.json(previewParentList());
    if (path.startsWith("/api/activities"))
      return Response.json(previewActivities(path));
    if (path === "/api/team/stamp-card")
      return Response.json(
        {
          error: "Die Stempelkarte selbst ist in der Vorschau nicht verfügbar.",
        },
        { status: 404 },
      );
    if (path === "/api/admin/stripe-conflicts")
      return Response.json(previewConflicts());
    if (path === "/api/probetraining/team" && init?.method !== "POST")
      return Response.json(previewTrials());
    if (path === "/api/probetraining/notices")
      return Response.json(previewTrialNotices());
    if (path === "/api/probetraining/past-events")
      return Response.json(previewTrialPastEvents());
    if (path === "/api/products/gifts/mine")
      return Response.json(previewGifts());
    if (/^\/api\/parent-profiles\/[^/]+\/units$/.test(path))
      return Response.json({
        units: previewFamily("parent").units,
        more: false,
      });
    if (/^\/api\/parent-profiles\/[^/]+\/finances$/.test(path))
      return Response.json({
        checked_at: new Date().toISOString(),
        complete: true,
        notes: [],
        currencies: [],
        payments: [
          {
            id: "ch-1",
            amount: 15200,
            refunded: 0,
            currency: "eur",
            status: "succeeded",
            description: "Subscription update",
            created_at: "2026-10-02T10:30:00Z",
            method: "card",
            method_detail: "Visa •••• 4242",
            failure: null,
          },
          {
            id: "ch-2",
            amount: 15200,
            refunded: 0,
            currency: "eur",
            status: "failed",
            description: "Subscription update",
            created_at: "2026-08-20T03:51:00Z",
            method: "card",
            method_detail: "Visa •••• 4242",
            failure: "Nicht genügend Deckung",
          },
          {
            id: "ch-3",
            amount: 15200,
            refunded: 0,
            currency: "eur",
            status: "failed",
            description: "Subscription update",
            created_at: "2026-08-06T03:51:00Z",
            method: "card",
            method_detail: "Mastercard •••• 5100",
            failure: "Karte abgelaufen",
          },
        ],
        subscriptions: {
          complete: true,
          previous: null,
          active: [
            { id: "s-1", names: ["FirstTouch"], cancel_at: null },
            { id: "s-2", names: ["Gamechanger"], cancel_at: null },
          ],
        },
      });
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
  /^\/(termine|stempelkarte|berichte|konto|profil|produkte|profil\/geschenkkarten|camps(\/[0-9a-f-]+)?|admin(\/(spieler|eltern|standorte|mitarbeiter|trainingsplanung|stempelkarten|einstellungen|einladungen|protokolle|stripe|produkte-berichte|elternprofile|spielerprofile|aktivitaeten|probetraining))?)?$/;
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

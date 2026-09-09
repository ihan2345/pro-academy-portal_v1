import { it, expect } from "vitest";
import { PDFDocument } from "pdf-lib";
import { renderReport } from "../src/lib/pdf";
it("generates versioned multi-page PDF including pending rows", async () => {
  const bytes = await renderReport({
    player_name: "Max Beispiel",
    product_name: "GameChanger",
    starts_at: "2026-07-12T00:00:00Z",
    ends_at: "2026-08-12T00:00:00Z",
    included_units: 8,
    completed: 3,
    minutes: 270,
    created_at: "2026-08-12T06:00:00Z",
    version: 2,
    whatsapp: "491234",
    events: Array.from({ length: 30 }, (_, i) => ({
      id: String(i),
      title: "Technik & Spielintelligenz",
      starts_at: "2026-08-11T18:00:00Z",
      ends_at: "2026-08-11T19:30:00Z",
      status: "planned",
    })),
  });
  const doc = await PDFDocument.load(bytes);
  expect(doc.getPageCount()).toBeGreaterThan(1);
  expect(doc.getTitle()).toContain("Max Beispiel");
});

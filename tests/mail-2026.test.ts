import { describe, expect, it } from "vitest";
import { calendarLinks, icsFile } from "../src/lib/mail-2026/calendar";
import {
  signCalendarEvent,
  verifyCalendarToken,
} from "../src/lib/mail-2026/ics-link";
import { greet, textToMail } from "../src/lib/mail-2026/from-text";
import { MAIL_EXTRA_SLOT } from "../src/lib/mail-2026/render";
import { htmlEmail } from "../src/lib/mail";

const event = {
  uid: "camp-1",
  title: "Herbstcamp 2026: Max",
  slots: ["21", "19", "20"].map((d) => ({
    starts_at: `2026-10-${d}T08:00:00Z`,
    ends_at: `2026-10-${d}T14:00:00Z`,
  })),
  location: "Sportpark Musterstadt, Weg 1",
  url: "https://portal.example.com/camps/1",
};

describe("Mail-Design 2026: Kalender", () => {
  it("baut eine .ics mit allen Tagen, Erinnerungen und Escaping", () => {
    const ics = icsFile(event, new Date("2026-10-01T00:00:00Z"));
    expect(ics.match(/BEGIN:VEVENT/g)).toHaveLength(3);
    expect(ics).toContain("DTSTART:20261019T080000Z");
    expect(ics).toContain("TRIGGER:-PT1440M");
    expect(ics).toContain("TRIGGER:-PT120M");
    expect(ics).toContain("LOCATION:Sportpark Musterstadt\\, Weg 1");
    expect(ics.split("\r\n").every((l) => new TextEncoder().encode(l).length <= 75)).toBe(true);
  });
  it("erzeugt Google-Serie und Outlook-Link für den ersten Tag", () => {
    const links = calendarLinks(event, "https://x/ics");
    expect(links.google).toContain("recur=RRULE%3AFREQ%3DDAILY%3BCOUNT%3D3");
    expect(links.google).toContain("20261019T080000Z%2F20261019T140000Z");
    expect(links.outlook).toContain("startdt=2026-10-19T08%3A00%3A00Z");
  });
  it("signierte Links: gültig, manipuliert, abgelaufen", async () => {
    const token = (await signCalendarEvent(event, "k"))!;
    const ok = await verifyCalendarToken(token, "k", Date.parse("2026-10-01"));
    expect(ok?.slots).toHaveLength(3);
    expect(await verifyCalendarToken(token, "anderer", Date.parse("2026-10-01"))).toBeNull();
    const [body, sig] = token.split(".");
    expect(await verifyCalendarToken(`${body}x.${sig}`, "k", Date.parse("2026-10-01"))).toBeNull();
    expect(await verifyCalendarToken(token, "k", Date.parse("2027-01-01"))).toBeNull();
    expect(await signCalendarEvent(event, "")).toBeNull();
  });
});

describe("Mail-Design 2026: Klartext → Layout", () => {
  it("setzt den Vornamen in die Anrede", () => {
    expect(greet("Hallo,\nText", "Laura Becker")).toBe("Hallo Laura,\nText");
    expect(greet("Hallo,\nText", "")).toBe("Hallo,\nText");
  });
  it("erkennt Anrede, Fakten, Termine, Zitate und Links", () => {
    const mail = textToMail(
      "Buchungsbestätigung: Herbstcamp",
      [
        "Hallo Laura,",
        "die Zahlung ist bestätigt.",
        "Ort: Sportpark",
        "19.10.2026 · 10:00–16:00 Uhr",
        "Camp-Bericht:",
        "Sehr stark.",
        "Angebote: https://portal.example.com/produkte",
        "https://wa.me/49123",
      ].join("\n"),
      "https://portal.example.com/camps",
    );
    expect(mail.greeting).toBe("Hallo Laura,");
    expect(mail.eyebrow).toBe("Buchungsbestätigung");
    expect(mail.title).toBe("Herbstcamp");
    expect(mail.flow).toEqual([
      { type: "p", text: "die Zahlung ist bestätigt." },
      { type: "fact", label: "Ort", value: "Sportpark", tone: undefined },
      { type: "fact", label: "19.10.2026", value: "10:00–16:00 Uhr" },
      { type: "quote", title: "Camp-Bericht", text: "Sehr stark." },
    ]);
    expect(mail.secondary).toEqual([
      { label: "Angebote", url: "https://portal.example.com/produkte" },
      { label: "Per WhatsApp schreiben", url: "https://wa.me/49123" },
    ]);
  });
  it("escapet Inhalte und lässt Platz für Geschenkkarten-Bilder", () => {
    const html = htmlEmail("<script>", "<b>x</b>", "https://example.com");
    expect(html).not.toContain("<script>");
    expect(html).toContain("&lt;b&gt;x&lt;/b&gt;");
    expect(html).toContain(MAIL_EXTRA_SLOT);
    expect(html).toContain("https://example.com/brand/logo-neon.png");
  });
});

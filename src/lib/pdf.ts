import {
  PDFDocument,
  PDFString,
  StandardFonts,
  rgb,
  type PDFPage,
  type PDFFont,
} from "pdf-lib";
import { brandLogoPngBase64 } from "./brand-logo-data";
import {
  formatDate,
  formatTime,
  periodLabel,
  durationLabel,
  STATUS_LABELS,
  isAttended,
  disciplineStats,
  type Attendance,
} from "./domain";
export interface ReportSnapshot {
  player_name: string;
  product_name: string;
  starts_at: string;
  ends_at: string;
  included_units: number;
  athletics_units?: number;
  completed: number;
  minutes: number;
  created_at: string;
  version: number;
  whatsapp: string;
  events: {
    id: string;
    title: string;
    event_type?: string;
    starts_at: string;
    ends_at: string;
    status: Attendance;
  }[];
}
const dark = rgb(0.043, 0.059, 0.102),
  lime = rgb(0.557, 1, 0.004),
  muted = rgb(0.46, 0.49, 0.54),
  purple = rgb(0.545, 0.325, 0.996);
export async function renderReport(snapshot: ReportSnapshot) {
  const pdf = await PDFDocument.create();
  const logo = await pdf.embedPng(brandLogoPngBase64);
  pdf.setTitle(
    `Trainingsbericht ${snapshot.player_name} · ${periodLabel(snapshot.starts_at, snapshot.ends_at)}`,
  );
  pdf.setAuthor("ProAcademy by Ayhan & Karaman");
  const regular = await pdf.embedFont(StandardFonts.Helvetica),
    bold = await pdf.embedFont(StandardFonts.HelveticaBold);
  let page!: PDFPage,
    y = 0;
  const clean = (text: string) =>
    text.replace(/[^\x20-\x7E\xA0-\xFF€–—’„“]/g, "?");
  function text(
    value: string,
    x: number,
    at: number,
    size = 10,
    font: PDFFont = regular,
    color = dark,
  ) {
    page.drawText(clean(value), { x, y: at, size, font, color });
  }
  function nextPage() {
    page = pdf.addPage([595.28, 841.89]);
    page.drawRectangle({
      x: 0,
      y: 734,
      width: 595.28,
      height: 108,
      color: dark,
    });
    page.drawImage(logo, {
      x: 40,
      y: 748,
      width: (80 * logo.width) / logo.height,
      height: 80,
    });
    text("BY AYHAN & KARAMAN", 122, 783, 9, bold, rgb(0.7, 0.73, 0.77));
    text("TRAININGSBERICHT", 365, 787, 12, bold, rgb(1, 1, 1));
    text(
      `Version ${snapshot.version} · ${formatDate(snapshot.created_at)}`,
      365,
      768,
      9,
      regular,
      rgb(0.7, 0.73, 0.77),
    );
    y = 705;
  }
  function footer() {
    text(
      "ProAcademy by Ayhan & Karaman · Vertraulich",
      40,
      31,
      8,
      regular,
      muted,
    );
    text(`Seite ${pdf.getPageCount()}`, 505, 31, 8, regular, muted);
  }
  nextPage();
  text(snapshot.player_name, 40, y, 25, bold);
  y -= 25;
  text(snapshot.product_name, 40, y, 12, bold, purple);
  y -= 22;
  text(
    `Leistungszeitraum ${periodLabel(snapshot.starts_at, snapshot.ends_at)}`,
    40,
    y,
    11,
    regular,
    muted,
  );
  y -= 45;
  text(`${snapshot.completed} / ${snapshot.included_units}`, 40, y, 29, bold);
  text(durationLabel(snapshot.minutes), 305, y, 24, bold);
  y -= 22;
  text("Einheiten absolviert", 40, y, 10, regular, muted);
  text("Absolvierte Trainingszeit", 305, y, 10, regular, muted);
  const split = disciplineStats(snapshot.events);
  const athletics = snapshot.athletics_units ?? 0;
  const groups =
    athletics > 0
      ? [
          {
            label: "Fußball",
            units: snapshot.included_units - athletics,
            completed: split.football.completed,
          },
          {
            label: "Athletik",
            units: athletics,
            completed: split.athletics.completed,
          },
        ]
      : [
          {
            label: "",
            units: snapshot.included_units,
            completed: snapshot.completed,
          },
        ];
  y -= 30;
  for (const group of groups) {
    if (group.label) {
      text(
        `${group.label}: ${group.completed} / ${group.units} Einheiten`,
        40,
        y,
        11,
        bold,
      );
      y -= 30;
    } else y -= 18;
    for (let i = 0; i < group.units; i++) {
      // At most eight stamps on each A4 row, including the new 12-unit PRO pass.
      if (i > 0 && i % 8 === 0) y -= 48;
      const x = 60 + (i % 8) * 64,
        done = i < group.completed;
      page.drawCircle({
        x,
        y,
        size: 19,
        color: done ? lime : rgb(0.96, 0.95, 0.98),
        borderColor: done ? lime : rgb(0.86, 0.84, 0.9),
        borderWidth: 1,
      });
      text(
        done ? "OK" : String(i + 1),
        x - (done ? 8 : i >= 9 ? 6 : 3),
        y - 4,
        done ? 10 : 11,
        bold,
        done ? dark : muted,
      );
    }
    y -= 42;
  }
  y -= 8;
  text("TRAININGSÜBERSICHT", 40, y, 10, bold);
  y -= 23;
  for (const event of snapshot.events) {
    if (y < 120) {
      footer();
      nextPage();
      text("TRAININGSÜBERSICHT · FORTSETZUNG", 40, y, 10, bold);
      y -= 25;
    }
    page.drawLine({
      start: { x: 40, y: y + 10 },
      end: { x: 555, y: y + 10 },
      thickness: 0.5,
      color: rgb(0.9, 0.91, 0.93),
    });
    text(
      `${formatDate(event.starts_at)}  ${formatTime(event.starts_at)} - ${formatTime(event.ends_at)}`,
      40,
      y - 6,
      10,
      bold,
    );
    const label =
      event.status === "planned" &&
      new Date(event.ends_at) <= new Date(snapshot.created_at)
        ? "Prüfung ausstehend"
        : STATUS_LABELS[event.status];
    text(
      label,
      402,
      y - 6,
      10,
      regular,
      isAttended(event.status) ? rgb(0.32, 0.5, 0.17) : purple,
    );
    let title = clean(
      `${event.event_type === "Athletiktraining" ? "Athletik · " : ""}${event.title}`,
    );
    while (regular.widthOfTextAtSize(title, 9) > 340)
      title = title.slice(0, -2);
    text(title, 40, y - 23, 9, regular, muted);
    y -= 42;
  }
  if (y < 130) {
    footer();
    nextPage();
  }
  y -= 10;
  text("Datenstand zum Erstellungszeitpunkt", 40, y, 10, bold);
  y -= 19;
  for (const line of [
    "Noch offene Prüfungen zählen nicht als absolvierte Einheiten.",
    "Nachträgliche Korrekturen können eine neue Berichtsversion auslösen.",
  ]) {
    text(line, 40, y, 9, regular, muted);
    y -= 15;
  }
  y -= 10;
  text("Fragen oder Unstimmigkeiten?", 40, y, 10, bold);
  y -= 17;
  const link = `https://wa.me/${snapshot.whatsapp.replace(/\D/g, "")}`;
  text(link, 40, y, 10, regular, purple);
  const annotation = pdf.context.obj({
    Type: "Annot",
    Subtype: "Link",
    Rect: [40, y - 3, 320, y + 12],
    Border: [0, 0, 0],
    A: { Type: "Action", S: "URI", URI: PDFString.of(link) },
  });
  page.node.addAnnot(pdf.context.register(annotation));
  footer();
  return pdf.save();
}

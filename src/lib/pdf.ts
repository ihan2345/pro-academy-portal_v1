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
  isChargedAbsence,
  disciplineStats,
  attendanceStats,
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
  attendance_policy?: "charged_absences_v1";
  whatsapp: string;
  events: {
    id: string;
    title: string;
    event_type?: string;
    starts_at: string;
    ends_at: string;
    status: Attendance;
    location_name?: string;
    trainer_name?: string;
    retrospective?: boolean;
    occurred_on?: string | null;
    duration_minutes?: number;
    parent_note?: string;
  }[];
}
const dark = rgb(0.043, 0.059, 0.102),
  lime = rgb(0.557, 1, 0.004),
  muted = rgb(0.46, 0.49, 0.54),
  purple = rgb(0.545, 0.325, 0.996);
const red = rgb(0.75, 0.14, 0.2);
const amber = rgb(0.965, 0.722, 0.247);
export async function renderReport(
  snapshot: ReportSnapshot,
  mode: "report" | "stamp_card" = "report",
) {
  const card = mode === "stamp_card";
  const pdf = await PDFDocument.create();
  const logo = await pdf.embedPng(brandLogoPngBase64);
  pdf.setTitle(
    `${card ? "Stempelkarte" : "Trainingsbericht"} ${snapshot.player_name} · ${periodLabel(snapshot.starts_at, snapshot.ends_at)}`,
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
    text(
      card ? "STEMPELKARTE" : "TRAININGSBERICHT",
      365,
      787,
      12,
      bold,
      rgb(1, 1, 1),
    );
    text(
      card
        ? `Stand ${formatDate(snapshot.created_at)} · ${formatTime(snapshot.created_at)}`
        : `Version ${snapshot.version} · ${formatDate(snapshot.created_at)}`,
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
  const fitSize = (value: string, size: number) =>
    Math.min(size, 515 / Math.max(bold.widthOfTextAtSize(clean(value), 1), 1));
  text(snapshot.player_name, 40, y, fitSize(snapshot.player_name, 25), bold);
  y -= 25;
  text(
    snapshot.product_name,
    40,
    y,
    fitSize(snapshot.product_name, 12),
    bold,
    purple,
  );
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
  const chargedPolicy = snapshot.attendance_policy === "charged_absences_v1";
  text(
    chargedPolicy ? "Einheiten angerechnet" : "Einheiten absolviert",
    40,
    y,
    10,
    regular,
    muted,
  );
  text("Absolvierte Trainingszeit", 305, y, 10, regular, muted);
  // Older immutable reports retain the counting policy captured with them.
  const countedEvents = chargedPolicy
    ? snapshot.events
    : snapshot.events.filter((e) => !isChargedAbsence(e.status));
  const split = disciplineStats(countedEvents);
  const athletics = snapshot.athletics_units ?? 0;
  const groups =
    athletics > 0
      ? [
          {
            label: "Fußball",
            units: snapshot.included_units - athletics,
            completed: split.football.completed,
            charged: split.football.charged,
            retrospective: split.football.retrospective,
            planned: split.football.planned,
          },
          {
            label: "Athletik",
            units: athletics,
            completed: split.athletics.completed,
            charged: split.athletics.charged,
            retrospective: split.athletics.retrospective,
            planned: split.athletics.planned,
          },
        ]
      : [
          {
            label: "",
            units: snapshot.included_units,
            completed: snapshot.completed,
            charged: attendanceStats(countedEvents).charged,
            retrospective: attendanceStats(countedEvents).retrospective,
            planned: attendanceStats(snapshot.events).planned,
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
      if (y < 120) {
        footer();
        nextPage();
        y -= 25;
      }
      const x = 60 + (i % 8) * 64,
        done = i < group.completed,
        charged = done && i >= group.completed - group.charged,
        retrospective =
          done &&
          !charged &&
          i >= group.completed - group.charged - group.retrospective,
        planned = card && !done && i < group.completed + group.planned;
      page.drawCircle({
        x,
        y,
        size: 19,
        color: charged
          ? red
          : retrospective
            ? amber
            : done
              ? lime
              : planned
                ? purple
                : rgb(0.96, 0.95, 0.98),
        borderColor: charged
          ? red
          : retrospective
            ? amber
            : done
              ? lime
              : planned
                ? purple
                : rgb(0.86, 0.84, 0.9),
        borderWidth: 1,
      });
      text(
        done ? "OK" : planned ? "PLAN" : String(i + 1),
        x - (done ? 8 : planned ? 13 : i >= 9 ? 6 : 3),
        y - 4,
        done ? 10 : 11,
        bold,
        charged ? rgb(1, 1, 1) : done ? dark : planned ? rgb(1, 1, 1) : muted,
      );
    }
    y -= 42;
  }
  if (card || chargedPolicy) {
    if (y < 160) {
      footer();
      nextPage();
    }
    text(
      chargedPolicy
        ? "OK grün = teilgenommen   OK orange = nachgetragen   OK rot = Absage"
        : "OK = absolviert   PLAN = geplant   Zahl = noch offen",
      40,
      y,
      9,
      regular,
      muted,
    );
    y -= 22;
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
      event.retrospective
        ? `${event.occurred_on ? formatDate(`${event.occurred_on}T12:00:00Z`) : "Datum nicht angegeben"} · ${event.duration_minutes} Minuten`
        : `${formatDate(event.starts_at)}  ${formatTime(event.starts_at)} - ${formatTime(event.ends_at)}`,
      40,
      y - 6,
      10,
      bold,
    );
    const label = event.retrospective
      ? "Nachgetragen"
      : event.status === "planned" &&
          new Date(event.ends_at) <= new Date(snapshot.created_at)
        ? "Prüfung ausstehend"
        : STATUS_LABELS[event.status];
    text(
      label,
      402,
      y - 6,
      10,
      regular,
      event.retrospective
        ? rgb(0.55, 0.32, 0.03)
        : chargedPolicy && isChargedAbsence(event.status)
          ? red
          : isAttended(event.status)
            ? rgb(0.32, 0.5, 0.17)
            : purple,
    );
    let title = clean(
      `${event.event_type === "Athletiktraining" ? "Athletik · " : ""}${event.title}`,
    );
    while (regular.widthOfTextAtSize(title, 9) > 340)
      title = title.slice(0, -2);
    text(title, 40, y - 23, 9, regular, muted);
    y -= 38;
    if (event.retrospective && event.parent_note) {
      // Wrap every character, including long unbroken notes, across pages.
      let line = "";
      const flush = () => {
        if (y < 80) {
          footer();
          nextPage();
        }
        text(line, 40, y, 9, regular, muted);
        y -= 14;
        line = "";
      };
      for (const char of `Elternnotiz: ${event.parent_note}`.replace(
        /\r/g,
        "",
      )) {
        if (char === "\n") {
          flush();
          continue;
        }
        if (regular.widthOfTextAtSize(line + clean(char), 9) > 510) flush();
        line += clean(char);
      }
      if (line) flush();
      y -= 12;
    }
  }
  const excused = snapshot.events.filter((event) => event.status === "excused");
  if (chargedPolicy && excused.length) {
    if (y < 160) {
      footer();
      nextPage();
    }
    text("ENTSCHULDIGT · OHNE ANRECHNUNG", 40, y, 11, bold, purple);
    y -= 20;
    text(
      "Keine Einheit und keine Trainingszeit angerechnet.",
      40,
      y,
      9,
      regular,
      muted,
    );
    y -= 23;
    for (const event of excused) {
      const details = [
        `${formatDate(event.starts_at)} · ${formatTime(event.starts_at)} - ${formatTime(event.ends_at)} Uhr`,
        event.title,
        [
          event.event_type,
          event.location_name,
          event.trainer_name && `Coach: ${event.trainer_name}`,
        ]
          .filter(Boolean)
          .join(" · "),
      ].filter(Boolean);
      const lines: string[] = [];
      for (const detail of details) {
        let line = "";
        for (const word of clean(detail).split(" ")) {
          if (regular.widthOfTextAtSize(`${line} ${word}`, 9) > 505 && line) {
            lines.push(line);
            line = "";
          }
          // Long unbroken input is split too, without omitting appointment data.
          for (const char of (line ? " " : "") + word) {
            if (regular.widthOfTextAtSize(line + char, 9) > 505) {
              lines.push(line);
              line = "";
            }
            line += char;
          }
        }
        if (line) lines.push(line);
      }
      if (y - lines.length * 14 < 65) {
        footer();
        nextPage();
      }
      for (const line of lines) {
        if (y < 65) {
          footer();
          nextPage();
        }
        text(line, 40, y, 9, regular, muted);
        y -= 14;
      }
      y -= 12;
    }
  }
  if (y < 145) {
    footer();
    nextPage();
  }
  y -= 10;
  text("Datenstand zum Erstellungszeitpunkt", 40, y, 10, bold);
  y -= 19;
  for (const line of [
    "Noch offene Prüfungen zählen nicht als absolvierte Einheiten.",
    ...(chargedPolicy
      ? [
          "Absagen zählen als Einheit; Trainingszeit nur bei tatsächlicher Teilnahme.",
        ]
      : []),
    card
      ? "Aktuelle Übersicht; kein abgeschlossener Monatsbericht."
      : "Nachträgliche Korrekturen können eine neue Berichtsversion auslösen.",
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

/*
 * Erzeugt die Vorschau aller Portal-Mails im Design 2026.
 *
 *   npx tsx scripts/mail-preview-2026.ts
 *
 * Schreibt:
 *   docs/mail-vorschau-2026/<nr>-<name>.html  (eine Datei pro Mail + index.html)
 *   supabase/templates/{magic-link,confirmation}.html (Supabase-Dashboard)
 *
 * Es wird nichts verschickt, keine Datenbank und kein Mail-Anbieter berührt.
 * Inhalte = aktuelle Texte aus src/lib/**, workers/** mit Beispieldaten.
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { renderMail2026, esc, type Mail2026 } from "../src/lib/mail-2026/render";
import {
  calendarLinks,
  icsFile,
  type CalendarEvent,
} from "../src/lib/mail-2026/calendar";

const APP = "https://portal.proacademy-ak.com";
const WA =
  "https://wa.me/4915143342392?text=Hallo%20ProAcademy-Team";
const support = { whatsapp: WA, email: "contact@proacademy-ak.com" };

type Entry = {
  slug: string;
  group: string;
  subject: string;
  trigger: string;
  mail: Mail2026;
};

const loginMail = (token: string, greeting: string): Mail2026 => ({
  preheader: "Dein sechsstelliger Code für das ProAcademy-Portal.",
  area: "Anmeldung",
  eyebrow: "Dein Anmeldecode",
  title: "Einfach Code eingeben.",
  subtitle:
    "Gib diesen sechsstelligen Code auf der Anmeldeseite des ProAcademy-Portals ein.",
  heroCode: { value: token, caption: "Nur einmal gültig · begrenzte Zeit" },
  greeting,
  paragraphs: [
    "du kannst diese E-Mail auf einem anderen Gerät lesen und den Code in deinem geöffneten Anmeldefenster eingeben.",
    "Alternativ kannst du dich auch mit diesem Link anmelden:",
  ],
  secondary: [{ label: "Jetzt mit Link anmelden", url: "{{ .ConfirmationURL }}" }],
  calloutAfterActions: true,
  callout: {
    tone: "purple",
    title: "Wichtig: gleicher Browser, gleiches Gerät",
    text: "Öffne den Link im selben Browser, in dem du ihn angefordert hast. Beispiel: Angefordert auf dem Handy in Chrome? Dann öffne ihn auch dort in Chrome, nicht in Safari oder im Browser deiner Mail-App.\nÖffnet er sich falsch? Halte den Button gedrückt (oder Rechtsklick), wähle „Link kopieren“ und füge ihn im ursprünglichen Browser in die Adresszeile ein.",
  },
  fineprint: [
    "Code und Link können einmal verwendet werden. Sobald du eine Methode nutzt, wird auch die andere ungültig. Teile Code und Link mit niemandem.",
    "Falls du diese Anmeldung nicht angefordert hast, kannst du die E-Mail ignorieren.",
  ],
});

const confirmMail = (token: string, greeting: string): Mail2026 => ({
  preheader: "Bestätige deine E-Mail-Adresse für das ProAcademy-Portal.",
  area: "Registrierung",
  eyebrow: "Willkommen",
  title: "Bestätige deine E-Mail-Adresse.",
  subtitle:
    "Nur noch ein Schritt, um deine Registrierung im ProAcademy-Portal abzuschließen.",
  heroCode: { value: token, caption: "Code auf der Anmeldeseite eingeben" },
  greeting,
  paragraphs: [
    "gib diesen sechsstelligen Code auf der Anmeldeseite des Portals ein. Alternativ kannst du den Link unten im selben Browser auf demselben Gerät öffnen, in dem du die Anmeldung angefordert hast.",
  ],
  secondary: [
    { label: "E-Mail-Adresse bestätigen", url: "{{ .ConfirmationURL }}" },
  ],
  fineprint: [
    "Code und Link sind nur begrenzt gültig und können einmal verwendet werden. Sobald du eine Methode nutzt, wird auch die andere ungültig.",
    "Falls du dich nicht registriert hast, kannst du die E-Mail ignorieren.",
  ],
});

const trainingChips = [
  "Mittwoch, 18. November",
  "Sportpark Nord",
  "Coach Max",
];

const entries: Entry[] = [
  // ---------- Anmeldung (Supabase) ----------
  {
    slug: "01-anmeldecode",
    group: "Anmeldung · Supabase",
    subject: "Dein Anmeldecode für ProAcademy",
    trigger: "Login mit E-Mail-Code / Magic Link",
    mail: loginMail("482913", "Hallo Laura,"),
  },
  {
    slug: "02-registrierung-bestaetigen",
    group: "Anmeldung · Supabase",
    subject: "Bestätige deine E-Mail-Adresse für ProAcademy",
    trigger: "Erste Registrierung",
    mail: confirmMail("482913", "Hallo Laura,"),
  },
  // ---------- Elternportal ----------
  {
    slug: "03-einladung",
    group: "Elternportal",
    subject: "Deine Einladung zur ProAcademy",
    trigger: "Admin lädt Eltern ein (aktuell deaktiviert)",
    mail: {
      preheader: "Dein persönlicher Zugang zum Elternportal ist bereit.",
      area: "Elternportal",
      eyebrow: "Deine Einladung",
      title: "Willkommen im Elternportal, Laura.",
      subtitle:
        "Termine, Fortschritt, Stempelkarte und Berichte von Noah an einem Ort.",
      primary: { label: "Einladung annehmen", url: `${APP}/auth/invite` },
      greeting: "Hallo Laura,",
      paragraphs: ["willkommen in deinem Elternportal. Deine persönliche Einladung ist sieben Tage gültig."],
      list: {
        title: "Das erwartet dich",
        items: [
          "Nächstes Training mit Countdown, Ort und Coach",
          "Kalender mit allen geplanten Einheiten",
          "Fortschritt, Stempelkarte und Trainingsberichte",
        ],
      },
      support,
    },
  },
  {
    slug: "04-training-geplant",
    group: "Training",
    subject: "Trainingsplanung: Noah am 18.11.2026",
    trigger: "Team plant ein Training ein",
    mail: {
      preheader: "Noahs nächstes Training steht fest.",
      area: "Training",
      eyebrow: "Training geplant",
      title: "Noah ist eingeplant.",
      heroTime: { start: "18:00", end: "19:30", caption: "Abschluss & Torschuss" },
      chips: trainingChips,
      primary: { label: "Im Portal ansehen", url: `${APP}/` },
      greeting: "Hallo Laura,",
      paragraphs: ["für Noah ist folgendes Training geplant:"],
      facts: [
        { label: "Datum", value: "Mi, 18.11.2026" },
        { label: "Uhrzeit", value: "18:00 – 19:30 Uhr" },
        { label: "Ort", value: "Sportpark Nord\nNordring 12, 44135 Dortmund" },
        { label: "Trainer", value: "Coach Max" },
      ],
      callout: {
        tone: "neutral",
        text: "Änderungen oder Stornierungen sind aktuell nur über unser Team möglich. Bitte kontaktiere uns per WhatsApp.",
      },
      secondary: [{ label: "Frage zum Training", url: WA }],
      support,
    },
  },
  {
    slug: "05-trainingserinnerung",
    group: "Training",
    subject: "Trainingserinnerung: Noah am 18.11.2026",
    trigger: "Erinnerung vor dem Training",
    mail: {
      preheader: "Zur Erinnerung: Noahs Training steht bevor.",
      area: "Training",
      eyebrow: "Nächstes Training · Morgen",
      title: "Bald geht's los, Noah.",
      heroTime: { start: "18:00", end: "19:30", caption: "Abschluss & Torschuss" },
      chips: trainingChips,
      primary: { label: "Route öffnen", url: "https://maps.google.com/?q=Sportpark+Nord" },
      greeting: "Hallo Laura,",
      paragraphs: ["zur Erinnerung: Das Training von Noah steht bevor."],
      callout: {
        tone: "lime",
        title: "Bitte mitbringen",
        text: "Sportsachen, passende Schuhe und etwas zu trinken.",
      },
      secondary: [{ label: "Frage zum Training", url: WA }],
      support,
    },
  },
  {
    slug: "06-trainingsplanung-aktualisiert",
    group: "Training",
    subject: "Trainingsplanung aktualisiert: Noah am 18.11.2026",
    trigger: "Termin, Ort oder Coach geändert",
    mail: {
      preheader: "Die Trainingsplanung für Noah wurde aktualisiert.",
      area: "Training",
      eyebrow: "Planung aktualisiert",
      title: "Neuer Stand für Noahs Training.",
      heroTime: { start: "17:30", end: "19:00", caption: "Abschluss & Torschuss" },
      chips: ["Mittwoch, 18. November", "Sportpark Nord", "Coach Sara"],
      primary: { label: "Im Kalender ansehen", url: `${APP}/termine` },
      greeting: "Hallo Laura,",
      paragraphs: [
        "die Trainingsplanung für Noah wurde aktualisiert. Hier ist der aktuelle Stand:",
      ],
      facts: [
        { label: "Uhrzeit", value: "17:30 – 19:00 Uhr", tone: "purple" },
        { label: "Ort", value: "Sportpark Nord\nNordring 12, 44135 Dortmund" },
        { label: "Trainer", value: "Coach Sara", tone: "purple" },
      ],
      secondary: [{ label: "Frage zum Training", url: WA }],
      support,
    },
  },
  {
    slug: "07-teilnahme-aufgehoben",
    group: "Training",
    subject: "Teilnahme am Training aufgehoben: Noah am 18.11.2026",
    trigger: "Kind aus einem Training entfernt",
    mail: {
      preheader: "Noah ist für dieses Training nicht mehr eingeplant.",
      area: "Training",
      eyebrow: "Teilnahme aufgehoben",
      title: "Noah ist nicht mehr eingeplant.",
      subtitle: "Abschluss & Torschuss · Mi, 18.11. · 18:00 – 19:30 Uhr",
      chips: ["Sportpark Nord", "Coach Max"],
      greeting: "Hallo Laura,",
      paragraphs: [
        "Noah wurde aus diesem Training entfernt und ist dafür nicht mehr eingeplant.",
        "Fragen oder Änderungen? Bitte kontaktiere uns per WhatsApp.",
      ],
      secondary: [{ label: "Frage zum Training", url: WA }],
      support,
    },
  },
  {
    slug: "08-training-absolviert",
    group: "Training",
    subject: "Training absolviert: Noah",
    trigger: "Coach trägt Teilnahme ein",
    mail: {
      preheader: "Stempel gesetzt: 3 von 4 Einheiten.",
      area: "Fortschritt",
      eyebrow: "Training absolviert",
      title: "Stark gemacht, Noah!",
      heroStat: { value: "3", unit: "/ 4", caption: "Einheiten in diesem Zeitraum" },
      chips: ["Mi, 18.11.", "18:00 – 19:30 Uhr", "90 Minuten"],
      primary: { label: "Fortschritt ansehen", url: `${APP}/fortschritt` },
      greeting: "Hallo Laura,",
      paragraphs: [
        "das Training von Noah am 18.11.2026 von 18:00 bis 19:30 Uhr wurde als absolviert eingetragen.",
      ],
      facts: [
        { label: "Trainingsdauer", value: "90 Minuten" },
        { label: "Angerechnete Einheiten", value: "3 von 4 Einheiten", tone: "lime" },
        { label: "Nächste Einheit", value: "Mi, 25.11. · 18:00 Uhr" },
      ],
      fineprint: [
        "Ist diese Angabe aus deiner Sicht nicht korrekt? Kontaktiere uns bitte über WhatsApp.",
      ],
      secondary: [{ label: "Angabe prüfen lassen", url: WA }],
      support,
    },
  },
  {
    slug: "09-training-korrigiert",
    group: "Training",
    subject: "Training aktualisiert: Noah",
    trigger: "Team korrigiert Teilnahme",
    mail: {
      preheader: "Unser Team hat ein Training von Noah aktualisiert.",
      area: "Fortschritt",
      eyebrow: "Training aktualisiert",
      title: "Teilnahme korrigiert.",
      heroStat: { value: "2", unit: "/ 4", caption: "Angerechnete Einheiten" },
      primary: { label: "Status im Portal", url: `${APP}/termine` },
      greeting: "Hallo Laura,",
      paragraphs: [
        "unser Team hat das Training von Noah am 18.11.2026 aktualisiert.",
      ],
      callout: {
        tone: "neutral",
        title: "So wird gezählt",
        text: "Vom Team abgesagte Termine und entschuldigte Teilnahmen verbrauchen keine Einheit. Individuell abgesagte oder nicht wahrgenommene Teilnahmen zählen weiterhin als Einheit. Trainingszeit zählt nur bei tatsächlicher Teilnahme.",
      },
      secondary: [{ label: "Fragen oder Unstimmigkeiten?", url: WA }],
      support,
    },
  },
  {
    slug: "10-training-absolviert-team",
    group: "Training",
    subject: "Training absolviert: Abschluss & Torschuss",
    trigger: "Bestätigung an Coach/Team",
    mail: {
      preheader: "4 Teilnahmen bestätigt.",
      area: "Team",
      eyebrow: "Training absolviert",
      title: "Abschluss & Torschuss",
      heroTime: { start: "18:00", end: "19:30", caption: "90 Minuten · 4 Teilnahmen" },
      chips: trainingChips,
      greeting: "Hallo Max,",
      paragraphs: [
        "das Training „Abschluss & Torschuss“ am 18.11.2026 von 18:00 bis 19:30 Uhr wurde als absolviert eingetragen.",
      ],
      list: {
        title: "Bestätigte Teilnahmen (4)",
        items: ["Noah Becker", "Mia Becker", "Elias Wagner", "Lina Hoffmann"],
      },
      fineprint: [
        "Ist diese Angabe aus deiner Sicht nicht korrekt? Kontaktiere uns bitte über WhatsApp.",
      ],
      secondary: [{ label: "Korrektur melden", url: WA }],
    },
  },
  {
    slug: "11-trainingsbericht",
    group: "Berichte",
    subject: "Dein Trainingsbericht für Noah",
    trigger: "Neuer Monatsbericht",
    mail: {
      preheader: "Noahs Bericht für Oktober 2026 ist da.",
      area: "Berichte",
      eyebrow: "Neuer Bericht",
      title: "Oktober 2026",
      subtitle: "Noahs Trainingsbericht ist da.",
      heroStat: { value: "4", unit: "/ 4", caption: "Einheiten absolviert" },
      primary: { label: "Berichte öffnen", url: `${APP}/berichte` },
      greeting: "Hallo Laura,",
      paragraphs: [
        "der neue Trainingsbericht von Noah ist verfügbar. Du findest ihn im Anhang und in deinem Elternportal. Noch ausstehende Teilnahmen sind im Bericht gekennzeichnet.",
      ],
      attachment: {
        name: "ProAcademy-Trainingsbericht.pdf",
        note: "Im Anhang · ohne Anmeldung lesbar",
      },
      support,
    },
  },
  {
    slug: "12-stempelkarte",
    group: "Berichte",
    subject: "Stempelkarte für Noah Becker",
    trigger: "Automatisch oder manuell durch Admin",
    mail: {
      preheader: "Die aktuelle Stempelkarte von Noah als PDF.",
      area: "Stempelkarte",
      eyebrow: "Stempelkarte",
      title: "Noahs aktuelle Stempelkarte.",
      heroStat: { value: "2", unit: "/ 4", caption: "3 Std. 0 Min. Training" },
      primary: { label: "Stempelkarte ansehen", url: `${APP}/stempelkarte` },
      paragraphs: [
        "im Anhang findest du die Stempelkarte für Noah Becker. Die Übersicht enthält absolvierte, nachgetragene und geplante Einheiten für den angegebenen Leistungszeitraum.",
      ],
      greeting: "Hallo Laura,",
      facts: [{ label: "Datenstand", value: "18.11.2026, 07:30 Uhr" }],
      attachment: {
        name: "ProAcademy-Stempelkarte.pdf",
        note: "Zum Öffnen ist keine Anmeldung nötig",
      },
      fineprint: [
        "Dies ist eine aktuelle Stempelkarte; bestehende Berichtsversionen bleiben erhalten.",
      ],
      support,
    },
  },
  // ---------- Camps ----------
  ...campEntries(),
  // ---------- Shop ----------
  {
    slug: "17-shop-kauf-zugang",
    group: "Shop",
    subject: "Deine Buchung: FirstTouch – Portalzugang bestätigen",
    trigger: "Gastkauf im Shop abgeschlossen",
    mail: {
      preheader: "Kauf abgeschlossen. Jetzt Portalzugang aktivieren.",
      area: "Shop",
      eyebrow: "Buchung bestätigt",
      title: "FirstTouch ist gebucht.",
      subtitle: "Aktiviere jetzt deinen persönlichen Portalzugang.",
      heroStat: { value: "149,00 €", caption: "Bezahlt · Bestellung abgeschlossen" },
      primary: { label: "Zugang aktivieren", url: `${APP}/auth/product` },
      greeting: "Hallo Laura,",
      paragraphs: [
        "dein Kauf von „FirstTouch“ wurde mit 149,00 € abgeschlossen. Die Buchung wurde im Portal übernommen.",
        "Bestätige deine E-Mail über den Button, um deinen persönlichen Portalzugang zu aktivieren. Dein Kauf bleibt auch ohne Aktivierung bestehen.",
      ],
      facts: [
        { label: "Produkt", value: "FirstTouch" },
        { label: "Betrag", value: "149,00 €" },
        { label: "Bestellnummer", value: "b71e…9c04", tone: "muted" },
      ],
      callout: {
        tone: "purple",
        text: "Dein Abonnement läuft unabhängig von der Aktivierung des Portalzugangs. Wiederkehrende Zahlungen richten sich nach deinem gewählten Tarif und dem bei Stripe angezeigten Rabatt.",
      },
      fineprint: [
        "Falls der Link abgelaufen ist, kannst du im Shop über die Bestellbestätigung oder über die Anmeldung einen neuen Zugangslink anfordern.",
      ],
      support,
    },
  },
  // ---------- Geschenkkarten ----------
  ...giftEntries(),
  // ---------- Probetraining ----------
  ...trialEntries(),
];

function campEntries(): Entry[] {
  const days = [
    { label: "Mo, 19.10.2026", value: "10:00 – 16:00 Uhr" },
    { label: "Di, 20.10.2026", value: "10:00 – 16:00 Uhr" },
    { label: "Mi, 21.10.2026", value: "10:00 – 16:00 Uhr" },
  ];
  const chips = ["19. – 21. Oktober", "Sportpark Musterstadt", "3 Tage"];
  const contact = [
    { label: "Per WhatsApp kontaktieren", url: WA },
    { label: "Per E-Mail kontaktieren", url: "mailto:mail@proacademy-ak.com" },
  ];
  const tz = "Alle Uhrzeiten gelten für Deutschland (Europe/Berlin).";
  return [
    {
      slug: "13-camp-buchung",
      group: "Camps",
      subject: "Buchungsbestätigung: Herbstcamp 2026 für Max Mustermann",
      trigger: "Zahlung für Camp bestätigt",
      mail: {
        preheader: "Der Camp-Platz für Max ist gebucht.",
        area: "Camps",
        eyebrow: "Camp gebucht",
        title: "Herbstcamp 2026",
        subtitle: "Der Camp-Platz für Max Mustermann ist sicher.",
        chips,
        primary: { label: "Camp im Portal", url: `${APP}/camps` },
        greeting: "Hallo Laura,",
        paragraphs: [
          "die Zahlung ist bestätigt und der Camp-Platz für Max Mustermann beim Herbstcamp 2026 ist gebucht.",
        ],
        factsTitle: "Camp-Tage",
        facts: [
          ...days,
          { label: "Ort", value: "Sportpark Musterstadt" },
          { label: "Frühbucherpreis (bereits reduziert)", value: "249,00 €" },
          { label: "Zusätzlicher Rabatt", value: "−24,90 €", tone: "purple" },
          { label: "Bezahlt", value: "224,10 €", tone: "lime" },
          { label: "Buchungsnummer", value: "3f2a9c1e-7b4d-…-2c5d6e7f8a9b", tone: "muted" },
        ],
        secondary: contact,
        fineprint: [
          tz,
          "Änderungen oder Fragen zur Teilnahme? Melde dich direkt bei unserem Team.",
        ],
        support,
      },
    },
    {
      slug: "14-camp-erinnerung-7-tage",
      group: "Camps",
      subject: "Camp-Erinnerung: Herbstcamp 2026 für Max Mustermann",
      trigger: "7 Tage vor Campstart",
      mail: {
        preheader: "In einer Woche startet das Herbstcamp.",
        area: "Camps",
        eyebrow: "Noch 7 Tage",
        title: "Herbstcamp 2026",
        subtitle: "Wir freuen uns auf Max Mustermann.",
        chips,
        primary: { label: "Camp-Details", url: `${APP}/camps` },
        greeting: "Hallo Laura,",
        paragraphs: [
          "wir freuen uns auf Max Mustermann beim Herbstcamp 2026. Hier findest du die wichtigsten Angaben:",
        ],
        factsTitle: "Camp-Tage",
        facts: [...days, { label: "Ort", value: "Sportpark Musterstadt" }],
        secondary: contact,
        fineprint: [
          tz,
          "Änderungen oder Fragen zur Teilnahme? Melde dich direkt bei unserem Team.",
        ],
        support,
      },
    },
    {
      slug: "15-camp-erinnerung-24h",
      group: "Camps",
      subject: "Letzte Camp-Erinnerung: Herbstcamp 2026 für Max Mustermann",
      trigger: "24 Stunden vor Campstart",
      mail: {
        preheader: "Morgen geht's los: Herbstcamp 2026.",
        area: "Camps",
        eyebrow: "Morgen geht's los",
        title: "Herbstcamp 2026",
        heroTime: { start: "10:00", end: "16:00", caption: "Tag 1 · Montag, 19. Oktober" },
        chips: ["Sportpark Musterstadt", "3 Tage"],
        primary: { label: "Route öffnen", url: "https://maps.google.com/?q=Sportpark+Musterstadt" },
        greeting: "Hallo Laura,",
        paragraphs: [
          "wir freuen uns auf Max Mustermann beim Herbstcamp 2026. Hier findest du die wichtigsten Angaben:",
        ],
        factsTitle: "Camp-Tage",
        facts: [...days, { label: "Ort", value: "Sportpark Musterstadt" }],
        secondary: contact,
        fineprint: [
          tz,
          "Änderungen oder Fragen zur Teilnahme? Melde dich direkt bei unserem Team.",
        ],
        support,
      },
    },
    {
      slug: "16-camp-teilnahme",
      group: "Camps",
      subject: "Camp-Teilnahme bestätigt: Max Mustermann",
      trigger: "Nach dem Camp, mit Bericht",
      mail: {
        preheader: "Teilnahme bestätigt und Camp-Bericht vom Team.",
        area: "Camps",
        eyebrow: "Camp abgeschlossen",
        title: "Danke fürs Mitmachen, Max!",
        heroStat: { value: "3", unit: "/ 3", caption: "Camp-Tage dabei · Herbstcamp 2026" },
        primary: { label: "Zum Elternportal", url: `${APP}/camps` },
        greeting: "Hallo Laura,",
        paragraphs: [
          "die Teilnahme von Max Mustermann am Herbstcamp 2026 ist bestätigt. Hier findest du die Zusammenfassung des Camps:",
        ],
        quote: {
          title: "Camp-Bericht",
          meta: "Coach Max · Herbstcamp 2026",
          text: "Max hat an allen drei Tagen mit viel Einsatz mitgemacht. Besonders stark: Ballannahme unter Druck und Abschluss mit dem schwächeren Fuß. Nächster Schwerpunkt: Spiel ohne Ball und Kommunikation.",
        },
        facts: [...days, { label: "Ort", value: "Sportpark Musterstadt" }],
        factsTitle: "Camp-Tage",
        secondary: contact,
        fineprint: [
          "Fragen oder eine Angabe stimmt nicht? Melde dich direkt bei unserem Team.",
        ],
        support,
      },
    },
  ];
}

function giftEntries(): Entry[] {
  const offers = `${APP}/produkte`;
  return [
    {
      slug: "18-geschenkkarte-kauf",
      group: "Geschenkkarten",
      subject: "Deine ProAcademy Geschenkkarte – Kauf bestätigt",
      trigger: "Käufer:in nach Zahlung",
      mail: {
        preheader: "Dein Kauf über 100,00 € ist bestätigt.",
        area: "Geschenkkarte",
        eyebrow: "Kauf bestätigt",
        title: "Danke, Laura. Deine Geschenkkarte ist bereit.",
        heroStat: { value: "100,00 €", caption: "Geschenkwert · einlösbar bis 18.11.2029" },
        primary: { label: "Bestellstatus ansehen", url: `${APP}/geschenkkarten/status` },
        greeting: "Hallo Laura,",
        paragraphs: [
          "dein Kauf über 100,00 € ist bestätigt. Die Geschenkbenachrichtigung wird separat an jonas@example.com zugestellt.",
        ],
        facts: [
          { label: "Ursprünglicher Geschenkcode", value: "PA-7KQ4-M2XD", tone: "purple" },
          { label: "Einlösbar bis", value: "18.11.2029" },
          { label: "Bestellnummer", value: "g-4f21…aa90", tone: "muted" },
        ],
        callout: {
          tone: "neutral",
          text: "Dein persönlicher Bestellstatus zeigt dir Kaufbestätigung und Zahlungsstatus. Die beschenkte Person erhält einen eigenen Link für Gutschein, Restguthaben und Verbrauchshistorie.",
        },
        secondary: [
          { label: "Rechnungsbeleg öffnen", url: `${APP}/rechnung` },
          { label: "Angebote ansehen", url: offers },
        ],
        fineprint: [
          "Im Geschenkwert sind 19 % Umsatzsteuer enthalten. Die Einlösung verrechnet den bereits versteuerten Einzweckgutschein.",
          "Gültig für neue Shopangebote einschließlich der ersten Abo-Zahlung. Frühbucher- und Abo-Vorteile werden zuerst berücksichtigt. Weitere Abo-Zahlungen werden regulär berechnet. Ein Kauf weiterer Geschenkkarten aus Guthaben ist ausgeschlossen.",
        ],
        support,
      },
    },
    {
      slug: "19-geschenkkarte-empfang",
      group: "Geschenkkarten",
      subject: "Laura Becker schenkt dir ProAcademy",
      trigger: "Beschenkte Person",
      mail: {
        preheader: "Eine ProAcademy Geschenkkarte über 100,00 € für dich.",
        area: "Geschenkkarte",
        eyebrow: "Ein Geschenk für dich",
        title: "Laura Becker schenkt dir ProAcademy.",
        heroCode: { value: "PA-7KQ4-M2XD", caption: "Dein Geschenkcode · 100,00 €" },
        primary: { label: "Angebote entdecken", url: offers },
        greeting: "Hallo Jonas,",
        paragraphs: [
          "Laura Becker hat dir eine ProAcademy Geschenkkarte über 100,00 € gekauft. Gib den Geschenkcode im Shop direkt beim Checkout ein. Ein gesondertes Gutscheinkonto ist nicht nötig.",
        ],
        facts: [
          { label: "Guthaben", value: "100,00 €", tone: "lime" },
          { label: "Einlösbar bis", value: "18.11.2029" },
        ],
        callout: {
          tone: "purple",
          title: "Gut zu wissen",
          text: "Nach jedem erfolgreichen Einsatz wird der bisherige Code gesperrt; für verbleibendes Guthaben erhältst du einen neuen Code. Über deinen persönlichen Statuslink siehst du jederzeit Code, Restguthaben und Historie, ohne Portalanmeldung.",
        },
        secondary: [{ label: "Bestellstatus ansehen", url: `${APP}/geschenkkarten/status` }],
        fineprint: [
          "Die Geschenkkarte (Vorder- und Rückseite) hängt als Bild an.",
          "ProAcademy begleitet Kinder und Familien im Fußballtraining. Im Elternportal verwaltest du deine Buchungen und Trainingsangebote.",
        ],
        support,
      },
    },
    {
      slug: "20-geschenkkarte-guthaben",
      group: "Geschenkkarten",
      subject: "Dein ProAcademy Geschenkguthaben: noch 51,00 €",
      trigger: "Nach Einlösung mit Restbetrag",
      mail: {
        preheader: "Neuer Code für dein Restguthaben.",
        area: "Geschenkkarte",
        eyebrow: "Guthaben aktualisiert",
        title: "Noch 51,00 € übrig.",
        heroCode: { value: "PA-R9TB-3HNC", caption: "Dein neuer Geschenkcode" },
        primary: { label: "Guthaben-Historie", url: `${APP}/geschenkkarten/status` },
        greeting: "Hallo Jonas,",
        paragraphs: [
          "durch deinen letzten Kauf mit der ProAcademy Geschenkkarte hat sich dein Guthaben geändert.",
        ],
        facts: [
          { label: "Guthaben davor", value: "100,00 €" },
          { label: "Bei diesem Kauf eingesetzt", value: "−49,00 €", tone: "purple" },
          { label: "Restbetrag", value: "51,00 €", tone: "lime" },
          { label: "Letzter Kauf", value: "Probetraining Plus" },
          { label: "Einlösung am", value: "18.11.2026, 08:12" },
          { label: "Zusätzlich gezahlt", value: "0,00 €" },
        ],
        callout: {
          tone: "lime",
          text: "Der vorherige Code wurde ersetzt. Nutze ab jetzt diesen Code für deinen Restbetrag. Gültig bis 18.11.2029, die ursprüngliche Gültigkeit bleibt bestehen.",
        },
        fineprint: [
          "Falls du inzwischen erneut eingekauft hast, gilt der im Bestellstatus angezeigte neueste Code.",
        ],
        support,
      },
    },
    {
      slug: "21-geschenkkarte-statuslink",
      group: "Geschenkkarten",
      subject: "Dein persönlicher ProAcademy Bestellstatus",
      trigger: "Statuslink erneut angefordert",
      mail: {
        preheader: "Dein persönlicher Link zum Bestellstatus.",
        area: "Geschenkkarte",
        eyebrow: "Bestellstatus",
        title: "Hier ist dein Statuslink.",
        subtitle:
          "Aktueller Geschenkcode, Restbetrag und Guthaben-Historie. Ohne Portalkonto.",
        primary: { label: "Bestellstatus ansehen", url: `${APP}/geschenkkarten/status` },
        greeting: "Hallo Jonas,",
        paragraphs: ["du hast deinen persönlichen Statuslink erneut angefordert."],
        facts: [{ label: "Bestellnummer", value: "g-4f21…aa90", tone: "muted" }],
        callout: {
          tone: "purple",
          title: "Bewahre den Link gut auf",
          text: "Wer ihn besitzt, kann die für dich freigegebenen Informationen sehen.",
        },
        support,
      },
    },
  ];
}

function trialEntries(): Entry[] {
  const portal = `${APP}/probetraining/willkommen`;
  const base = { area: "Probetraining", support, signature: "Euer ProAcademy-Team" };
  const chips = ["Sa, 21. November", "Sportpark Nord", "Coach Max"];
  return [
    {
      slug: "22-probetraining-willkommen",
      group: "Probetraining",
      subject: "Willkommen bei der ProAcademy",
      trigger: "Nach Probetraining-Anfrage",
      mail: {
        ...base,
        preheader: "Danke für eure Anfrage. Bitte E-Mail bestätigen.",
        eyebrow: "Euer Probetraining",
        title: "Willkommen bei der ProAcademy.",
        subtitle: "Dein Spiel. Deine Entwicklung.",
        primary: { label: "Willkommensportal öffnen", url: portal },
        greeting: "Hallo Laura,",
        paragraphs: [
          "vielen Dank für eure kostenlose Probetraining-Anfrage! Bitte bestätigt eure E-Mail und öffnet euer Willkommensportal.",
        ],
        list: {
          title: "So geht es weiter",
          items: [
            "E-Mail bestätigen und Willkommensportal öffnen",
            "Wir rufen euch an und stimmen einen Termin ab",
            "Kein Abo und keine Zahlungsdaten nötig",
          ],
        },
      },
    },
    {
      slug: "23-probetraining-geplant",
      group: "Probetraining",
      subject: "Probetraining geplant: Noah Becker",
      trigger: "Team plant Probetraining",
      mail: {
        ...base,
        preheader: "Euer Probetraining steht fest.",
        eyebrow: "Probetraining geplant",
        title: "Wir freuen uns auf Noah!",
        heroTime: { start: "10:00", end: "11:30", caption: "Probetraining U10" },
        chips,
        primary: { label: "Termin im Portal", url: portal },
        greeting: "Hallo Laura,",
        facts: [
          { label: "Datum", value: "Sa, 21.11.2026" },
          { label: "Uhrzeit", value: "10:00 – 11:30 Uhr" },
          { label: "Ort", value: "Sportpark Nord\nNordring 12, 44135 Dortmund" },
          { label: "Coach", value: "Coach Max" },
        ],
        callout: {
          tone: "lime",
          title: "Bitte mitbringen",
          text: "Sportsachen, passende Schuhe und etwas zu trinken. Wenn ihr den Termin ändern müsst, meldet euch bitte beim Team.",
        },
      },
    },
    {
      slug: "24-probetraining-erinnerung",
      group: "Probetraining",
      subject: "Erinnerung an euer Probetraining: Noah Becker",
      trigger: "Vor dem Probetraining",
      mail: {
        ...base,
        preheader: "Bald ist es so weit.",
        eyebrow: "Erinnerung",
        title: "Bald ist es so weit, Noah.",
        heroTime: { start: "10:00", end: "11:30", caption: "Probetraining U10" },
        chips,
        primary: { label: "Route öffnen", url: "https://maps.google.com/?q=Sportpark+Nord" },
        greeting: "Hallo Laura,",
        paragraphs: ["wir freuen uns auf Noah Becker!"],
        callout: {
          tone: "lime",
          title: "Bitte mitbringen",
          text: "Sportsachen, passende Schuhe und etwas zu trinken. Wenn ihr den Termin ändern müsst, meldet euch bitte beim Team.",
        },
        secondary: [{ label: "Termin im Portal", url: portal }],
      },
    },
    {
      slug: "25-probetraining-abgesagt",
      group: "Probetraining",
      subject: "Probetraining abgesagt: Noah Becker",
      trigger: "Abgesagt / verpasst / entschuldigt (3 Varianten, gleicher Aufbau)",
      mail: {
        ...base,
        preheader: "Lasst uns einen Ersatztermin finden.",
        eyebrow: "Termin abgesagt",
        title: "Wir finden einen neuen Termin.",
        subtitle: "Probetraining · Sa, 21.11.2026",
        greeting: "Hallo Laura,",
        paragraphs: [
          "das Probetraining von Noah Becker am 21.11.2026 findet nicht wie geplant statt. Bitte meldet euch beim Team, damit wir einen passenden Ersatztermin persönlich abstimmen können.",
        ],
        secondary: [{ label: "Ersatztermin per WhatsApp", url: WA }],
        fineprint: [
          "Varianten: „Probetraining verpasst“ (wir haben Noah vermisst) und „Probetraining entschuldigt“ nutzen denselben Aufbau.",
        ],
      },
    },
    {
      slug: "26-probetraining-feedback",
      group: "Probetraining",
      subject: "Euer Probetraining: Feedback für Noah",
      trigger: "Coach gibt Feedback",
      mail: {
        ...base,
        preheader: "Persönliches Feedback vom Coach.",
        eyebrow: "Feedback vom Coach",
        title: "Schön, dass Noah bei uns war!",
        heroStat: { value: "4", unit: "/ 5", caption: "Bewertung vom Coach" },
        greeting: "Hallo Laura,",
        paragraphs: ["hier ist das persönliche Feedback vom Coach:"],
        quote: {
          title: "Coach Max",
          text: "Noah hat super mitgezogen, ist mutig ins Dribbling gegangen und hat gut zugehört. Beim Passspiel mit links steckt noch viel Potenzial.",
        },
        rating: {
          title: "Wie war euer Probetraining?",
          text: "Ein Klick speichert eure Bewertung.",
          urls: [1, 2, 3, 4, 5].map((n) => `${portal}?rating=${n}`),
        },
        fineprint: [
          "Nach dem Klick seht ihr eure gespeicherten Sterne und könnt einmalig eine persönliche Nachricht ergänzen.",
        ],
        secondary: [{ label: "Willkommensportal", url: portal }],
      },
    },
    {
      slug: "27-probetraining-tag-7",
      group: "Probetraining",
      subject: "Euer nächster Schritt mit der ProAcademy",
      trigger: "7 Tage nach Probetraining (Werbe-Einwilligung)",
      mail: {
        ...base,
        preheader: "Lasst uns den nächsten Schritt planen.",
        eyebrow: "Euer nächster Schritt",
        title: "Weiter geht's, Noah.",
        primary: { label: "Academy-Angebote ansehen", url: "https://proacademy-ak.com/" },
        greeting: "Hallo Laura,",
        paragraphs: [
          "nach dem Probetraining von Noah möchten wir mit euch den nächsten Schritt planen. Regelmäßiges Training gibt Raum, Technik, Spielverständnis und Selbstvertrauen weiterzuentwickeln.",
        ],
        list: {
          title: "Unser Portal unterstützt euch mit",
          items: [
            "einer gemeinsamen Terminübersicht",
            "transparenten Einheiten",
            "persönlichem Feedback",
          ],
        },
        fineprint: [
          "Weitere Angebotsmails könnt ihr im Willkommensportal abbestellen.",
        ],
      },
    },
    {
      slug: "28-probetraining-tag-14",
      group: "Probetraining",
      subject: "Academy und Vereinstraining: gemeinsam weiterentwickeln",
      trigger: "14 Tage nach Probetraining (letzte Mail der Folge)",
      mail: {
        ...base,
        preheader: "Academy ergänzt das Vereinstraining.",
        eyebrow: "Academy + Verein",
        title: "Gemeinsam weiterentwickeln.",
        primary: { label: "Academy-Angebote ansehen", url: "https://proacademy-ak.com/" },
        greeting: "Hallo Laura,",
        paragraphs: [
          "wie geht es Noah seit dem Probetraining? Unsere Academy ergänzt das Vereinstraining mit persönlichen Schwerpunkten, Freude am Fußball und klaren nächsten Schritten.",
          "Wir besprechen gern passende Trainingszeiten und Angebote mit euch.",
        ],
        fineprint: [
          "Dies ist die letzte Nachricht unserer Probetraining-Angebotsfolge. Weitere Angebotsmails könnt ihr im Willkommensportal abbestellen.",
        ],
      },
    },
  ];
}

// Termin-Mails: „In Kalender eintragen“ (Apple, Google/Android, Outlook, .ics).
const sportparkNord = "Sportpark Nord, Nordring 12, 44135 Dortmund";
const training: Omit<CalendarEvent, "uid"> = {
  title: "ProAcademy Training: Noah · Abschluss & Torschuss",
  slots: [{ starts_at: "2026-11-18T17:00:00Z", ends_at: "2026-11-18T18:30:00Z" }],
  location: sportparkNord,
  description: "Coach Max. Bitte Sportsachen, passende Schuhe und etwas zu trinken mitbringen.",
  url: `${APP}/`,
};
const camp: Omit<CalendarEvent, "uid"> = {
  title: "ProAcademy Herbstcamp 2026: Max Mustermann",
  slots: ["19", "20", "21"].map((d) => ({
    starts_at: `2026-10-${d}T08:00:00Z`,
    ends_at: `2026-10-${d}T14:00:00Z`,
  })),
  location: "Sportpark Musterstadt",
  url: `${APP}/camps`,
};
const trial: Omit<CalendarEvent, "uid"> = {
  title: "ProAcademy Probetraining: Noah",
  slots: [{ starts_at: "2026-11-21T09:00:00Z", ends_at: "2026-11-21T10:30:00Z" }],
  location: sportparkNord,
  description: "Coach Max. Bitte Sportsachen, passende Schuhe und etwas zu trinken mitbringen.",
  url: `${APP}/probetraining/willkommen`,
};
const campNote =
  "Alle 3 Camp-Tage mit Erinnerung 1 Tag und 2 Stunden vorher. Outlook übernimmt nur den ersten Tag.";
const calendarFor: Record<string, [Omit<CalendarEvent, "uid">, string?]> = {
  "04-training-geplant": [training],
  "05-trainingserinnerung": [training],
  "06-trainingsplanung-aktualisiert": [
    {
      ...training,
      slots: [{ starts_at: "2026-11-18T16:30:00Z", ends_at: "2026-11-18T18:00:00Z" }],
      description: "Coach Sara. Neue Uhrzeit 17:30 – 19:00 Uhr.",
    },
    "Neue Uhrzeit eintragen. Den alten Termin bitte im Kalender löschen.",
  ],
  "13-camp-buchung": [camp, campNote],
  "14-camp-erinnerung-7-tage": [camp, campNote],
  "15-camp-erinnerung-24h": [camp, campNote],
  "23-probetraining-geplant": [trial],
  "24-probetraining-erinnerung": [trial],
};

const root = process.cwd();
const outDir = join(root, "docs", "mail-vorschau-2026");
const tplDir = join(root, "supabase", "templates");
mkdirSync(outDir, { recursive: true });
mkdirSync(tplDir, { recursive: true });

mkdirSync(join(outDir, "kalender"), { recursive: true });
for (const e of entries) {
  const cal = calendarFor[e.slug];
  if (cal) {
    const event: CalendarEvent = { uid: e.slug, ...cal[0] };
    // Vorschau: .ics liegt neben der Mail. Live: signierter Portal-Link + Anhang.
    const ics = `kalender/${e.slug}.ics`;
    writeFileSync(join(outDir, ics), icsFile(event, new Date("2026-11-18T07:00:00Z")));
    e.mail.calendar = { links: calendarLinks(event, ics), note: cal[1] };
  }
  writeFileSync(join(outDir, `${e.slug}.html`), renderMail2026(e.mail));
}

writeFileSync(
  join(tplDir, "magic-link.html"),
  renderMail2026(loginMail("{{ .Token }}", "Hallo{{ if .Data.first_name }} {{ .Data.first_name }}{{ end }},")),
);
writeFileSync(
  join(tplDir, "confirmation.html"),
  renderMail2026(confirmMail("{{ .Token }}", "Hallo{{ if .Data.first_name }} {{ .Data.first_name }}{{ end }},")),
);

const groups = [...new Set(entries.map((e) => e.group))];
writeFileSync(
  join(outDir, "index.html"),
  `<!doctype html><html lang="de"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Mail-Vorschau 2026</title><style>body{margin:0;background:#f5f5f7;color:#1d1d1f;font:16px -apple-system,BlinkMacSystemFont,'Helvetica Neue',Arial,sans-serif;padding:40px 20px}main{max-width:900px;margin:auto}h1{font-size:44px;letter-spacing:-.04em;margin:0}p.lead{color:#6e6e73}h2{margin:36px 0 12px;font-size:22px}a.card{display:flex;justify-content:space-between;gap:16px;padding:16px 20px;margin:0 0 8px;background:#fff;border-radius:18px;color:inherit;text-decoration:none}a.card:hover{box-shadow:0 8px 28px rgba(16,24,40,.08)}small{color:#6e6e73}</style></head><body><main><h1>Mail-Vorschau 2026</h1><p class="lead">${entries.length} Portal-Mails im Design 2026. Beispieldaten, kein Versand.</p>${groups
    .map(
      (g) =>
        `<h2>${esc(g)}</h2>${entries
          .filter((e) => e.group === g)
          .map(
            (e) =>
              `<a class="card" href="${e.slug}.html"><span><strong>${esc(e.subject)}</strong><br><small>${esc(e.trigger)}</small></span><small>${e.slug.slice(0, 2)}</small></a>`,
          )
          .join("")}`,
    )
    .join("")}</main></body></html>`,
);

writeFileSync(
  join(outDir, "mails.json"),
  JSON.stringify(
    entries.map(({ slug, group, subject, trigger }) => ({
      slug,
      group,
      subject,
      trigger,
    })),
    null,
    2,
  ),
);
console.log(`${entries.length} Mails + 2 Supabase-Vorlagen geschrieben.`);

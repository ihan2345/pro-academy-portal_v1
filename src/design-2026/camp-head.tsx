"use client";
// Design 2026: Seitenkopf der Camps (Eltern und Team) wie die Zentrale.
// Rechnet nur mit den bereits geladenen Camp-Daten.
import { CalendarDays, Euro, Ticket, Users } from "lucide-react";
import { formatDate } from "@/lib/domain";
import { maximumSeats } from "@/lib/camps/domain";
import { PageHead, SheetRow } from "./page-head";

type CampLite = {
  id: string;
  title: string;
  location: string;
  capacity: number;
  buffer_percent: number;
  status: string;
  occupied?: number;
  days: { starts_at: string }[];
};
type BookingLite = {
  id: string;
  camp_id: string;
  status: string;
  paid_amount: number;
  child_data: { first_name: string; last_name: string };
};

export function CampHead({
  team,
  camps,
  bookings,
  actions,
}: {
  team: boolean;
  camps: CampLite[];
  bookings: BookingLite[];
  actions?: React.ReactNode;
}) {
  const now = Date.now();
  const upcoming = camps
    .filter(
      (c) =>
        c.status !== "archived" &&
        c.days[0] &&
        Date.parse(c.days[0].starts_at) > now,
    )
    .sort((a, b) => a.days[0].starts_at.localeCompare(b.days[0].starts_at));
  const paid = bookings.filter((b) => b.status === "paid");
  const title = (id: string) => camps.find((c) => c.id === id)?.title ?? "Camp";
  // Belegung kommt nur vom Server: für das Team immer, für Eltern erst ab 80 %
  // Auslastung. Eigene Buchungen sind keine Belegung des ganzen Camps.
  const withSeats = upcoming.filter((c) => c.occupied != null);
  const left = (c: CampLite) => Math.max(0, maximumSeats(c) - c.occupied!);
  const free = withSeats.reduce((s, c) => s + left(c), 0);
  const revenue = paid.reduce((s, b) => s + (b.paid_amount ?? 0), 0);
  const campList = (
    <div className="d26-mini-list">
      {upcoming.map((c) => (
        <SheetRow
          key={c.id}
          title={c.title}
          meta={`${formatDate(c.days[0].starts_at)} · ${c.location}`}
          pill={
            c.occupied == null
              ? undefined
              : !left(c)
                ? "Ausgebucht"
                : team
                  ? `${left(c)} frei`
                  : `Nur noch ${left(c)} frei`
          }
          href={`/camps/${c.id}`}
        />
      ))}
      {!upcoming.length && <p className="d26-empty">Kein Camp geplant.</p>}
    </div>
  );
  const bookingList = (
    <div className="d26-mini-list">
      {paid.map((b) => (
        <SheetRow
          key={b.id}
          title={`${b.child_data.first_name} ${b.child_data.last_name}`}
          meta={title(b.camp_id)}
          pill="Bezahlt"
          href={`/camps/${b.camp_id}`}
        />
      ))}
      {!paid.length && <p className="d26-empty">Noch keine Buchung.</p>}
    </div>
  );
  const next = upcoming[0];
  const days = next
    ? Math.ceil((Date.parse(next.days[0].starts_at) - now) / 86400000)
    : 0;
  return (
    <PageHead
      title="Camps"
      greeting={
        next
          ? `${next.title} startet in ${days === 1 ? "einem Tag" : `${days} Tagen`}. ${team ? `${paid.length} bezahlte Buchungen insgesamt.` : paid.length ? `Ihr habt ${paid.length} ${paid.length === 1 ? "Platz" : "Plätze"} gebucht.` : "Sichert euch jetzt einen Platz."}`
          : team
            ? "Planung, Buchungen und Berichte an einem Ort."
            : "Hier erscheinen kommende Camps und eure Buchungen."
      }
      actions={actions}
      kpis={[
        {
          icon: CalendarDays,
          value: upcoming.length,
          label: "Kommende Camps",
          sheet: { title: "Kommende Camps", body: campList },
        },
        {
          icon: Ticket,
          value: paid.length,
          label: team ? "Bezahlte Buchungen" : "Eure Buchungen",
          sheet: {
            title: team ? "Bezahlte Buchungen" : "Eure Buchungen",
            body: bookingList,
          },
        },
        ...(team || withSeats.length
          ? [
              {
                icon: Users,
                value: free,
                label: team ? "Freie Plätze" : "Nur noch frei",
                tip: team
                  ? "Über alle kommenden Camps, inklusive Pufferplätzen und Buchungen in Prüfung, wie im Camp-Detail"
                  : "Diese Camps sind schon zu über 80 % ausgebucht",
                sheet: { title: "Freie Plätze je Camp", body: campList },
              },
            ]
          : []),
        ...(team
          ? [
              {
                icon: Euro,
                value: new Intl.NumberFormat("de-DE", {
                  style: "currency",
                  currency: "EUR",
                  maximumFractionDigits: 0,
                }).format(revenue / 100),
                label: "Bezahlt gesamt",
              },
            ]
          : []),
      ]}
    />
  );
}

"use client";
// Design 2026: Seitenkopf der Camps (Eltern und Team) wie die Zentrale.
// Rechnet nur mit den bereits geladenen Camp-Daten.
import { useState } from "react";
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
  paid_at?: string | null;
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
  // „Bezahlt gesamt“: alle Buchungen mit Status „bezahlt“ über ALLE Camps,
  // auch vergangene und archivierte. Storniert/erstattet zählt nicht.
  const euro = (cents: number, digits = 2) =>
    new Intl.NumberFormat("de-DE", {
      style: "currency",
      currency: "EUR",
      minimumFractionDigits: 0,
      maximumFractionDigits: digits,
    }).format(cents / 100);
  const campStart = (c?: CampLite) => c?.days[0]?.starts_at ?? "";
  const revenueGroups = [...new Set(paid.map((b) => b.camp_id))]
    .map((id) => {
      const camp = camps.find((c) => c.id === id);
      const rows = paid
        .filter((b) => b.camp_id === id)
        .sort((a, b) => (b.paid_at ?? "").localeCompare(a.paid_at ?? ""));
      return {
        id,
        camp,
        rows,
        sum: rows.reduce((s, b) => s + (b.paid_amount ?? 0), 0),
      };
    })
    .sort((a, b) => campStart(b.camp).localeCompare(campStart(a.camp)));
  const campState = (c?: CampLite) =>
    !c
      ? "nicht in der Liste"
      : c.status === "archived"
        ? "archiviert"
        : c.days[0] && Date.parse(c.days[0].starts_at) > now
          ? "kommend"
          : "vorbei";
  const revenueList = (
    <>
      <div className="d26-sheet-stats">
        <div>
          <b>{euro(revenue, 0)}</b>
          <span>bezahlt gesamt</span>
        </div>
        <div>
          <b>{paid.length}</b>
          <span>Buchungen</span>
        </div>
        <div>
          <b>{revenueGroups.length}</b>
          <span>Camps</span>
        </div>
      </div>
      <p className="d26-footnote">
        Die Summe umfasst alle bezahlten Buchungen über alle Camps, auch
        vergangene und archivierte. Stornierte und erstattete Buchungen zählen
        nicht mit.
      </p>
      <RevenueByCamp groups={revenueGroups} euro={euro} state={campState} />
      {!paid.length && (
        <div className="d26-mini-list">
          <p className="d26-empty">Noch keine bezahlte Buchung.</p>
        </div>
      )}
    </>
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
                value: euro(revenue, 0),
                label: "Bezahlt gesamt",
                tip: "Alle bezahlten Buchungen über alle Camps, auch vergangene und archivierte",
                sheet: {
                  eyebrow: "Zahlungen je Camp",
                  title: "Bezahlt gesamt",
                  body: revenueList,
                },
              },
            ]
          : []),
      ]}
    />
  );
}

type RevenueGroup = {
  id: string;
  camp?: CampLite;
  rows: BookingLite[];
  sum: number;
};

// Auswahl-Leiste: ein Chip je Camp mit Zahlsumme, darunter nur die
// Zahlungen des gewählten Camps.
function RevenueByCamp({
  groups,
  euro,
  state,
}: {
  groups: RevenueGroup[];
  euro: (cents: number, digits?: number) => string;
  state: (c?: CampLite) => string;
}) {
  const [pick, setPick] = useState(groups[0]?.id);
  const g = groups.find((x) => x.id === pick) ?? groups[0];
  if (!g) return null;
  return (
    <>
      <div className="d26-chips d26-revenue-switch" aria-label="Camps">
        {groups.map((x) => (
          <button
            key={x.id}
            type="button"
            className={`d26-chip ${x.id === g.id ? "is-active" : ""}`}
            aria-pressed={x.id === g.id}
            onClick={() => setPick(x.id)}
          >
            {x.camp?.title ?? "Unbekanntes Camp"}
            <em>{euro(x.sum, 0)}</em>
          </button>
        ))}
      </div>
      <div className="d26-sheet-group">
        <h4>
          {g.camp?.title ?? "Unbekanntes Camp"}
          <span>{euro(g.sum)}</span>
        </h4>
        <p className="d26-footnote">
          {[
            g.camp?.days[0] && formatDate(g.camp.days[0].starts_at),
            g.camp?.location,
            state(g.camp),
            `${g.rows.length} ${g.rows.length === 1 ? "Buchung" : "Buchungen"}`,
          ]
            .filter(Boolean)
            .join(" · ")}
        </p>
        <div className="d26-mini-list">
          {g.rows.map((b) => (
            <SheetRow
              key={b.id}
              title={`${b.child_data.first_name} ${b.child_data.last_name}`}
              meta={
                b.paid_at ? `Bezahlt am ${formatDate(b.paid_at)}` : "Bezahlt"
              }
              pill={b.paid_amount != null ? euro(b.paid_amount) : "Bezahlt"}
              href={g.camp ? `/camps/${g.id}` : undefined}
            />
          ))}
        </div>
      </div>
    </>
  );
}

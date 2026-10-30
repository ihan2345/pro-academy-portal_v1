"use client";
import { useState } from "react";
import Link from "next/link";
import {
  ArrowUpRight,
  CalendarDays,
  Clock3,
  MapPin,
  Users,
} from "lucide-react";
import {
  type Camp,
  type Offer,
  currentOffer,
  maximumSeats,
  money,
  campTiming,
} from "@/lib/camps/domain";

type SummaryCamp = Camp & { occupied?: number };
export function CampOverview({
  camps,
  offers = [],
}: {
  camps: SummaryCamp[];
  offers?: Pick<Offer, "camp_id" | "kind" | "amount" | "currency">[];
}) {
  const [filter, setFilter] = useState("all");
  const now = Date.now();
  const upcoming = camps.filter(
    (c) => campTiming(c, now).phase !== "past",
  ).length;
  const displayed = camps
    .filter(
      (c) =>
        filter === "all" ||
        (campTiming(c, now).phase === "past") === (filter === "past"),
    )
    .sort((a, b) => {
      const x = campTiming(a, now),
        y = campTiming(b, now);
      if ((x.phase === "past") !== (y.phase === "past"))
        return x.phase === "past" ? 1 : -1;
      return x.phase === "past" ? y.end - x.end : x.start - y.start;
    });
  const day = new Intl.DateTimeFormat("de-DE", {
    timeZone: "Europe/Berlin",
    dateStyle: "medium",
  });
  return (
    <section className="camp-overview" aria-label="Alle Camps">
      <div className="camp-overview-toolbar">
        <div>
          <h2>Deine Campübersicht</h2>
          <p>
            {upcoming} geplant oder laufend · {camps.length - upcoming}{" "}
            vergangen
          </p>
        </div>
        <div className="camp-segments" role="group" aria-label="Camp-Zeitraum">
          {[
            ["all", "Alle"],
            ["upcoming", "Geplant"],
            ["past", "Vergangen"],
          ].map(([value, label]) => (
            <button
              key={value}
              type="button"
              aria-pressed={filter === value}
              onClick={() => setFilter(value)}
            >
              {label}
            </button>
          ))}
        </div>
      </div>
      {displayed.length ? (
        <div className="camp-overview-grid">
          {displayed.map((camp) => {
            const timing = campTiming(camp, now),
              offer = currentOffer(
                offers.filter((o) => o.camp_id === camp.id),
                camp.early_bird_until,
                now,
              );
            const full =
              camp.occupied != null && camp.occupied >= maximumSeats(camp);
            const status =
              camp.status === "archived"
                ? "Archiviert"
                : camp.status === "draft"
                  ? "In Vorbereitung"
                  : timing.phase === "past"
                    ? "Stattgefunden"
                    : camp.status === "closed"
                      ? "Anmeldung geschlossen"
                      : full
                        ? "Ausgebucht"
                        : timing.phase === "ongoing"
                          ? "Läuft gerade"
                          : "Anmeldung offen";
            const tone =
              camp.status === "archived" || timing.phase === "past"
                ? "muted"
                : camp.status === "open" && !full
                  ? "open"
                  : "quiet";
            return (
              <Link
                className="camp-overview-card"
                key={camp.id}
                href={`/camps/${camp.id}`}
                aria-label={`${camp.title} öffnen`}
              >
                <div className="camp-overview-card-top">
                  <span className="camp-overview-icon">
                    <CalendarDays size={24} />
                  </span>
                  <span className={`camp-overview-status ${tone}`}>
                    {status}
                  </span>
                </div>
                <span className="camp-overview-eyebrow">
                  {timing.phase === "past"
                    ? "CAMP-RÜCKBLICK"
                    : timing.phase === "ongoing"
                      ? "AUF DEM PLATZ"
                      : "DEIN NÄCHSTES CAMP"}
                </span>
                <h3>{camp.title}</h3>
                <p className="camp-overview-description">
                  {camp.description ||
                    "Training, Teamgeist und gemeinsame Erlebnisse."}
                </p>
                <dl>
                  <div>
                    <dt>
                      <CalendarDays size={14} /> Zeitraum
                    </dt>
                    <dd>
                      {day.format(timing.start)}
                      {day.format(timing.start) !== day.format(timing.end)
                        ? ` – ${day.format(timing.end)}`
                        : ""}
                    </dd>
                  </div>
                  <div>
                    <dt>
                      <MapPin size={14} /> Ort
                    </dt>
                    <dd>{camp.location}</dd>
                  </div>
                  <div>
                    <dt>
                      <Users size={14} /> Alter
                    </dt>
                    <dd>
                      {camp.min_age}–{camp.max_age} Jahre
                      {camp.occupied != null
                        ? ` · ${camp.occupied}/${maximumSeats(camp)} Plätze`
                        : ""}
                    </dd>
                  </div>
                  <div>
                    <dt>
                      <Clock3 size={14} /> Training
                    </dt>
                    <dd>
                      {camp.days.length}{" "}
                      {camp.days.length === 1 ? "Tag" : "Tage"} ·{" "}
                      {new Intl.NumberFormat("de-DE", {
                        maximumFractionDigits: 1,
                      }).format(timing.hours)}{" "}
                      Std.
                    </dd>
                  </div>
                </dl>
                <div className="camp-overview-card-footer">
                  <div>
                    {offer && (
                      <>
                        <small>
                          {offer.kind === "early" && timing.phase !== "past"
                            ? "Frühbucherpreis"
                            : "Camppreis"}
                        </small>
                        <strong>{money(offer.amount, offer.currency)}</strong>
                      </>
                    )}
                  </div>
                  <span>
                    Camp ansehen <ArrowUpRight size={16} />
                  </span>
                </div>
              </Link>
            );
          })}
        </div>
      ) : (
        <div className="camp-panel camp-overview-empty">
          <CalendarDays size={30} />
          <h3>Hier sind noch keine Camps</h3>
          <p>Wähle einen anderen Zeitraum, um weitere Camps zu sehen.</p>
        </div>
      )}
    </section>
  );
}

"use client";
// Design 2026: Hero für das nächste Camp mit Countdown, Plätzen und
// Frühbucher-Frist. Nur Darstellung der vorhandenen Camp-Daten.
import Link from "next/link";
import { ArrowUpRight, MapPin, Timer, Users } from "lucide-react";
import {
  type Camp,
  type Offer,
  campTiming,
  currentOffer,
  maximumSeats,
  money,
} from "@/lib/camps/domain";
import { Countdown } from "./ui";
import { useMounted } from "./parent-experience";

export function CampSpotlight({
  camps,
  offers,
}: {
  camps: (Camp & { occupied?: number })[];
  offers: Pick<Offer, "camp_id" | "kind" | "amount" | "currency">[];
}) {
  const mounted = useMounted();
  if (!mounted) return null;
  const now = Date.now();
  const next = camps
    .filter((c) => campTiming(c, now).phase !== "past")
    .sort((a, b) => campTiming(a, now).start - campTiming(b, now).start)[0];
  if (!next) return null;
  const t = campTiming(next, now);
  const seats = maximumSeats(next);
  const taken = Math.min(next.occupied ?? 0, seats);
  const free = Math.max(seats - taken, 0);
  const own = offers.filter((o) => o.camp_id === next.id);
  const offer = currentOffer(own, next.early_bird_until, now);
  const early =
    next.early_bird_until && Date.parse(next.early_bird_until) > now
      ? next.early_bird_until
      : null;
  const day = new Intl.DateTimeFormat("de-DE", {
    timeZone: "Europe/Berlin",
    day: "numeric",
    month: "long",
  });
  return (
    <section className="d26-hero d26-camp-hero">
      <div className="d26-hero-top">
        <span className="d26-live">
          <i /> Nächstes Camp
        </span>
        <span>
          {day.format(t.start)} – {day.format(t.end)}
        </span>
      </div>
      <h2 className="d26-camp-title">{next.title}</h2>
      <p className="d26-hero-title">{next.description}</p>
      <Countdown to={new Date(t.start).toISOString()} />
      <div className="d26-camp-stats">
        <div data-tip={`${taken} von ${seats} Plätzen vergeben`}>
          <small>
            <Users size={14} /> Plätze
          </small>
          <b>{free} frei</b>
          <i>
            <em style={{ width: `${(taken / seats) * 100}%` }} />
          </i>
        </div>
        <div>
          <small>
            <MapPin size={14} /> Ort
          </small>
          <b>{next.location}</b>
        </div>
        {offer && (
          <div data-tip={early ? "Frühbucherpreis" : "Camppreis"}>
            <small>
              <Timer size={14} /> {early ? "Frühbucher bis" : "Preis"}
            </small>
            <b>
              {money(offer.amount, offer.currency)}
              {early && <span> · bis {day.format(Date.parse(early))}</span>}
            </b>
          </div>
        )}
      </div>
      <div className="d26-hero-actions">
        <Link className="d26-btn is-primary" href={`/camps/${next.id}`}>
          Camp ansehen <ArrowUpRight size={16} />
        </Link>
      </div>
    </section>
  );
}

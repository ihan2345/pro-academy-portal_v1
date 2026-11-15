"use client";
// Design 2026: Wallet-Übersicht über den Geschenkkarten. Rechnet nur mit den
// bereits geladenen Karten, Einlösen und Verknüpfen bleiben unverändert.
import { CalendarClock, Gift, Inbox, Send, Wallet } from "lucide-react";
import { giftMoney } from "@/lib/gifts/domain";
import { giftExpiry } from "@/lib/gifts/artwork";

type Card = {
  roles: ("buyer" | "recipient")[];
  available: number;
  expires_at: string;
  initial_amount: number;
};

export function GiftWallet({
  cards,
  available,
}: {
  cards: Card[];
  available: number;
}) {
  const received = cards.filter((c) => c.roles.includes("recipient"));
  const given = cards.filter((c) => c.roles.includes("buyer"));
  const next = cards
    .filter((c) => c.available > 0 && Date.parse(c.expires_at) > Date.now())
    .sort((a, b) => a.expires_at.localeCompare(b.expires_at))[0];
  const givenValue = given.reduce((s, c) => s + c.initial_amount, 0);
  const tiles = [
    {
      icon: Gift,
      value: String(cards.length),
      label: cards.length === 1 ? "Karte" : "Karten",
    },
    { icon: Inbox, value: String(received.length), label: "Erhalten" },
    {
      icon: Send,
      value: String(given.length),
      label: "Verschenkt",
      tip: givenValue ? `${giftMoney(givenValue)} verschenkt` : undefined,
    },
    {
      icon: CalendarClock,
      value: next ? giftExpiry(next.expires_at) : "–",
      label: "Nächster Ablauf",
      tip: next ? `${giftMoney(next.available)} laufen dann ab` : undefined,
    },
  ];
  return (
    <div className="d26-gift-wallet">
      <div className="d26-gift-balance">
        <Wallet size={20} />
        <small>Verfügbares Guthaben</small>
        <b>{giftMoney(available)}</b>
      </div>
      <div className="d26-gift-tiles">
        {tiles.map((t) => (
          <div className="d26-card d26-mini-kpi" key={t.label} data-tip={t.tip}>
            <t.icon size={16} />
            <b>{t.value}</b>
            <span>{t.label}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

/** Verbrauchsbalken für eine erhaltene Karte. */
export function GiftUsage({
  remaining,
  initial,
}: {
  remaining: number;
  initial: number;
}) {
  if (!initial) return null;
  const share = Math.min(1, Math.max(0, remaining / initial));
  return (
    <i
      className="d26-gift-usage"
      data-tip={`${giftMoney(initial - remaining)} von ${giftMoney(initial)} eingelöst`}
    >
      <em style={{ width: `${share * 100}%` }} />
    </i>
  );
}

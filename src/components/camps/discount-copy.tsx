"use client";
import { useEffect, useState } from "react";
import { Copy } from "lucide-react";
import { campApi } from "./shared";
import type { CampBookingStatus } from "@/lib/camps/domain";
import { BookingStatusButton } from "./booking-status";

export function DiscountCopy({
  code,
  percent,
}: {
  code: string;
  percent: number;
}) {
  const [copied, setCopied] = useState(false);
  const [manual, setManual] = useState(false);
  return (
    <div className="camp-discount">
      <button
        type="button"
        className="primary-button"
        onClick={async () => {
          try {
            // Keep clipboard access directly inside the click, without a preceding network request.
            await navigator.clipboard.writeText(code);
            setCopied(true);
            setManual(false);
          } catch {
            setCopied(false);
            setManual(true);
          }
        }}
      >
        <Copy size={16} />
        {copied ? "Rabattcode kopiert" : `Mein Rabatt: ${percent} %`}
      </button>
      {manual && (
        <label role="status">
          Dein Browser erlaubt kein automatisches Kopieren. Markiere diesen Code
          und kopiere ihn manuell:
          <input
            aria-label="Rabattcode zum manuellen Kopieren"
            value={code}
            readOnly
            onFocus={(event) => event.currentTarget.select()}
            onClick={(event) => event.currentTarget.select()}
          />
        </label>
      )}
    </div>
  );
}

export function CampDiscountCopy({
  campId,
  playerId,
}: {
  campId: string;
  playerId: string;
}) {
  const [discount, setDiscount] = useState<{
    code: string | null;
    percent: number;
    booking_status?: CampBookingStatus;
  } | null>(null);
  const [error, setError] = useState("");
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    let current = true;
    setDiscount(null);
    setError("");
    campApi(`discount?camp_id=${campId}&player_id=${playerId}`)
      .then((result) => {
        if (current) setDiscount(result);
      })
      .catch(() => {
        if (current) setError("Rabatt konnte nicht geladen werden.");
      });
    return () => {
      current = false;
    };
  }, [campId, playerId, attempt]);
  if (error)
    return (
      <span role="status">
        {error}{" "}
        <button
          type="button"
          className="secondary-button"
          onClick={() => setAttempt(attempt + 1)}
        >
          Erneut laden
        </button>
      </span>
    );
  if (!discount)
    return (
      <button type="button" className="primary-button" disabled>
        Rabatt wird geladen …
      </button>
    );
  if (discount.booking_status)
    return <BookingStatusButton status={discount.booking_status} />;
  if (!discount.code)
    return <span>Für dieses Angebot ist kein Rabattcode verfügbar.</span>;
  return (
    <DiscountCopy
      key={discount.code}
      code={discount.code}
      percent={discount.percent}
    />
  );
}

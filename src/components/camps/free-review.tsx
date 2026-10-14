"use client";
import { useEffect, useState } from "react";
import { campApi } from "./shared";
import {
  ReviewEditor,
  type Family,
  type Record as ReviewRecord,
} from "./stripe-review";
type Booking = {
  created_at: string;
  id: string;
  camp_id: string;
  stripe_session_id: string | null;
  review_reason: string | null;
  parent_data: { name: string; email: string; phone?: string };
  child_data: {
    first_name: string;
    last_name: string;
    birth_date?: string;
    age_at_booking?: number;
    gender: string;
    clothing_size: string;
  };
};
export function FreeCampReview({
  campId,
  onApproved,
}: {
  campId: string;
  onApproved: () => void;
}) {
  const [data, setData] = useState<{
      bookings: Booking[];
      families: Family[];
    } | null>(null),
    [error, setError] = useState("");
  const refresh = async () => {
    setData(await campApi(`free-review?camp_id=${campId}`));
  };
  useEffect(() => {
    let active = true;
    setData(null);
    setError("");
    campApi(`free-review?camp_id=${campId}`)
      .then((r) => {
        if (active) setData(r);
      })
      .catch((e) => {
        if (active) setError(e.message);
      });
    return () => {
      active = false;
    };
  }, [campId]);
  if (error)
    return (
      <p role="alert" className="camp-error">
        {error}
      </p>
    );
  if (!data?.bookings.length) return null;
  return (
    <section className="camp-panel">
      <h2>Gratisbuchungen · Sonderrabatt prüfen</h2>
      <p>
        Vorhandene Campbuchungen mit 0 € Zahlbetrag. Jede Freigabe erfordert
        einen aktuellen Stripe-Nachweis und eine ausdrückliche
        Admin-Bestätigung.
      </p>
      {data.bookings.map((b) => {
        const r: ReviewRecord = {
          booking_id: b.id,
          payment_id: b.stripe_session_id ?? "",
          child_name: `${b.child_data.first_name} ${b.child_data.last_name}`,
          parent_name: b.parent_data.name,
          parent_email: b.parent_data.email,
          parent_phone: b.parent_data.phone ?? "",
          created_at: b.created_at,
          age_at_booking: b.child_data.age_at_booking?.toString() ?? "",
          clothing_size: b.child_data.clothing_size,
          amount: 0,
          status: "review",
          issues: [],
          imported: false,
          draft: {
            parent_id: null,
            player_id: null,
            child: { ...b.child_data },
            notes: "",
          },
        };
        return (
          <article className="camp-booking" key={b.id}>
            <h3>{r.child_name}</h3>
            <p>
              {r.parent_name} · {r.parent_email}
            </p>
            <p>
              Gespeicherter Prüfgrund: {b.review_reason ?? "Nicht angegeben"}
            </p>
            <ReviewEditor
              record={r}
              families={data.families}
              campId={campId}
              done={async () => {
                await refresh();
                onApproved();
              }}
            />
          </article>
        );
      })}
    </section>
  );
}

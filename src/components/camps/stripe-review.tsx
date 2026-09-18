"use client";
import { useEffect, useState } from "react";
import { campApi, date } from "./shared";
import { money } from "@/lib/camps/domain";
type Child = {
  first_name: string;
  last_name: string;
  birth_date: string;
  gender: string;
  clothing_size: string;
};
type Draft = {
  parent_id: string | null;
  player_id: string | null;
  child: Child;
  notes: string;
  new_parent?: { name: string; email: string; phone: string } | null;
};
type Family = {
  id: string;
  full_name: string;
  parent_players: {
    players: {
      id: string;
      first_name: string;
      last_name: string;
      camp_birth_date: string | null;
      camp_gender: string | null;
      camp_clothing_size: string | null;
      archived_at: string | null;
    };
  }[];
};
type Record = {
  payment_id: string;
  child_name: string;
  parent_name: string;
  age_at_booking: string;
  clothing_size: string;
  amount: number;
  status: "paid" | "review" | "refunded";
  issues: string[];
  draft: Draft | null;
  imported: boolean;
};
type Review = {
  running: boolean;
  stale: boolean;
  checked_at: string | null;
  error: string | null;
  sources: { payment_link_id: string }[];
  records: Record[];
  families: Family[];
  imported_count: number;
};
function ReviewEditor({
  record,
  families,
  campId,
  done,
}: {
  record: Record;
  families: Family[];
  campId: string;
  done: () => Promise<void>;
}) {
  const [draft, setDraft] = useState<Draft>(
    record.draft ?? {
      parent_id: null,
      player_id: null,
      child: {
        first_name: record.child_name.split(" ")[0] ?? "",
        last_name: record.child_name.split(" ").slice(1).join(" "),
        birth_date: "",
        gender: "keine Angabe",
        clothing_size: record.clothing_size,
      },
      notes: "",
    },
  );
  const [busy, setBusy] = useState(false),
    [message, setMessage] = useState("");
  const update = (key: keyof Child, value: string) =>
    setDraft((d) => ({ ...d, child: { ...d.child, [key]: value } }));
  return (
    <form
      className="camp-form"
      onSubmit={async (e) => {
        e.preventDefault();
        setBusy(true);
        setMessage("");
        const add =
          (e.nativeEvent as SubmitEvent).submitter?.getAttribute("value") ===
          "import";
        try {
          await campApi(add ? "review-import" : "review-save", {
            ...draft,
            camp_id: campId,
            payment_id: record.payment_id,
          });
          setMessage(
            add ? "Kind zum Camp hinzugefügt." : "Angaben gespeichert.",
          );
          await done();
        } catch (e) {
          setMessage((e as Error).message);
        } finally {
          setBusy(false);
        }
      }}
    >
      <fieldset disabled={busy} className="camp-review-fields">
        <label>
          Familie
          <select
            value={draft.new_parent ? "new" : "existing"}
            onChange={(e) =>
              setDraft((d) => ({
                ...d,
                parent_id: null,
                player_id: null,
                new_parent:
                  e.target.value === "new"
                    ? { name: record.parent_name, email: "", phone: "" }
                    : null,
              }))
            }
          >
            <option value="existing">Vorhandene Familie zuordnen</option>
            <option value="new">Neue Familie anlegen</option>
          </select>
        </label>
        {draft.new_parent ? (
          <div className="camp-grid">
            {(
              [
                ["name", "Name des Elternteils"],
                ["email", "E-Mail der Eltern"],
                ["phone", "Telefon"],
              ] as const
            ).map(([key, label]) => (
              <label key={key}>
                {label}
                <input
                  type={key === "email" ? "email" : "text"}
                  value={draft.new_parent![key]}
                  onChange={(e) =>
                    setDraft((d) => ({
                      ...d,
                      new_parent: { ...d.new_parent!, [key]: e.target.value },
                    }))
                  }
                />
              </label>
            ))}
          </div>
        ) : (
          <label>
            Vorhandenes Kind / Elternkonto
            <select
              value={
                draft.parent_id && draft.player_id
                  ? `${draft.parent_id}|${draft.player_id}`
                  : ""
              }
              onChange={(e) => {
                const [parent_id, player_id] = e.target.value.split("|");
                const child = families
                  .find((f) => f.id === parent_id)
                  ?.parent_players.find(
                    (p) => p.players.id === player_id,
                  )?.players;
                setDraft((d) => ({
                  ...d,
                  parent_id: parent_id || null,
                  player_id: player_id || null,
                  child: child
                    ? {
                        ...d.child,
                        first_name: child.first_name,
                        last_name: child.last_name,
                        birth_date:
                          d.child.birth_date || child.camp_birth_date || "",
                        gender: child.camp_gender || d.child.gender,
                        clothing_size:
                          d.child.clothing_size ||
                          child.camp_clothing_size ||
                          "",
                      }
                    : d.child,
                }));
              }}
            >
              <option value="">Zuordnung prüfen und auswählen</option>
              {families.flatMap((f) =>
                f.parent_players
                  .filter((p) => !p.players.archived_at)
                  .map(({ players: p }) => (
                    <option key={`${f.id}|${p.id}`} value={`${f.id}|${p.id}`}>
                      {p.first_name} {p.last_name} · {f.full_name}
                    </option>
                  )),
              )}
            </select>
          </label>
        )}
        <div className="camp-grid">
          <label>
            Vorname
            <input
              value={draft.child.first_name}
              maxLength={80}
              onChange={(e) => update("first_name", e.target.value)}
            />
          </label>
          <label>
            Nachname
            <input
              value={draft.child.last_name}
              maxLength={80}
              onChange={(e) => update("last_name", e.target.value)}
            />
          </label>
          <label>
            Geburtsdatum
            <input
              type="date"
              value={draft.child.birth_date}
              onInput={(e) => update("birth_date", e.currentTarget.value)}
              onChange={(e) => update("birth_date", e.target.value)}
            />
          </label>
          <label>
            Geschlecht
            <select
              value={draft.child.gender}
              onChange={(e) => update("gender", e.target.value)}
            >
              {["keine Angabe", "weiblich", "männlich", "divers"].map((v) => (
                <option key={v}>{v}</option>
              ))}
            </select>
          </label>
          <label>
            Kleidergröße
            <input
              value={draft.child.clothing_size}
              maxLength={20}
              onChange={(e) => update("clothing_size", e.target.value)}
            />
          </label>
        </div>
        <label>
          Prüfnotiz
          <textarea
            value={draft.notes}
            maxLength={2000}
            onChange={(e) => setDraft((d) => ({ ...d, notes: e.target.value }))}
          />
        </label>
        <p className="camp-muted">
          {draft.new_parent
            ? "Eltern und Kind werden erst beim Hinzufügen angelegt. Ein bestehender Kontakt mit derselben E-Mail muss zugeordnet werden. Es wird keine Einladung versendet."
            : "Die ausgewählte Eltern-Kind-Verknüpfung bleibt bestehen. Die Namen gelten für diese Camp-Buchung; das ergänzte Geburtsdatum und die Camp-Angaben werden am Kind hinterlegt."}
        </p>
        <div className="camp-actions">
          <button className="secondary-button" type="submit" value="save">
            Angaben speichern
          </button>
          <button
            className="primary-button"
            type="submit"
            value="import"
            disabled={
              record.status !== "paid" ||
              (draft.new_parent
                ? !draft.new_parent.name || !draft.new_parent.email
                : !draft.player_id) ||
              !draft.child.birth_date ||
              !draft.child.first_name ||
              !draft.child.last_name ||
              !draft.child.clothing_size
            }
          >
            Zum Camp hinzufügen
          </button>
        </div>
      </fieldset>
      {message && <p role="status">{message}</p>}
    </form>
  );
}
export function StripeReview({
  campId,
  onImported,
}: {
  campId: string;
  onImported: () => void;
}) {
  const [review, setReview] = useState<Review | null>(null),
    [error, setError] = useState("");
  async function refresh() {
    const r = await campApi(`review?id=${campId}`);
    setReview(r);
    setError("");
  }
  useEffect(() => {
    let active = true;
    let timer: ReturnType<typeof setTimeout>;
    async function read() {
      try {
        const r = await campApi(`review?id=${campId}`);
        if (active) {
          setReview(r);
          setError("");
        }
      } catch (e) {
        if (active) setError((e as Error).message);
      } finally {
        if (active) timer = setTimeout(read, 30000);
      }
    }
    void read();
    return () => {
      active = false;
      clearTimeout(timer);
    };
  }, [campId]);
  return (
    <section
      className="camp-panel"
      aria-label="Kinder zur Prüfung / Angaben ergänzen"
    >
      <h2>Kinder zur Prüfung / Angaben ergänzen</h2>
      {error && (
        <p role="alert" className="camp-error">
          {error}
        </p>
      )}
      {!review ? (
        <p>Prüfstand wird geladen …</p>
      ) : (
        <>
          <p>
            {review.running && !review.stale
              ? "Abgleich aktiv · alle 5 Minuten"
              : "Abgleich pausiert oder Prüfstand veraltet"}
            {review.checked_at && (
              <> · Zuletzt geprüft: {date(review.checked_at)}</>
            )}
          </p>
          {review.error && (
            <p role="alert" className="camp-error">
              {review.error}
            </p>
          )}
          <p>
            {review.imported_count} bereits übernommen · {review.records.length}{" "}
            zur Prüfung
          </p>
          {!review.sources.length && (
            <p>Kein externer Stripe-Link für dieses Camp hinterlegt.</p>
          )}
          {!!review.sources.length && !review.records.length && (
            <p>Alle erfassten Buchungen wurden übernommen.</p>
          )}
          {review.records.map((r) => (
            <article className="camp-booking" key={r.payment_id}>
              <div className="camp-actions">
                <h3>
                  {[r.draft?.child.first_name, r.draft?.child.last_name]
                    .filter(Boolean)
                    .join(" ") ||
                    r.child_name ||
                    "Kind noch zu klären"}
                </h3>
                <span className="badge">
                  {r.status === "paid"
                    ? "Bezahlt · Angaben prüfen"
                    : r.status === "refunded"
                      ? "Erstattet"
                      : "Klärung erforderlich"}
                </span>
              </div>
              <p>
                Stripe-Angaben: {r.child_name} ·{" "}
                {r.parent_name || "Kontakt noch zu klären"} · {money(r.amount)}{" "}
                · Alter {r.age_at_booking || "unbekannt"} · Größe{" "}
                {r.clothing_size || "unbekannt"}
              </p>
              {r.issues.map((issue) => (
                <p className="camp-error" key={issue}>
                  {issue}
                </p>
              ))}
              {r.imported ? (
                <p>
                  Bereits übernommen. Der geänderte Zahlungsstatus muss vor
                  einer Anpassung der Camp-Buchung geprüft werden.
                </p>
              ) : (
                <ReviewEditor
                  record={r}
                  families={review.families}
                  campId={campId}
                  done={async () => {
                    await refresh();
                    onImported();
                  }}
                />
              )}
            </article>
          ))}
        </>
      )}
    </section>
  );
}

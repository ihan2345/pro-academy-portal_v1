"use client";
import { useRef, useState } from "react";
import type { Period, PortalData } from "@/lib/types";
import { periodLabel } from "@/lib/domain";
import { Modal } from "./portal";

export function BackfillForm({
  period,
  discipline,
  data,
  close,
  saved,
}: {
  period: Period;
  discipline: "football" | "athletics";
  data: PortalData;
  close: () => void;
  saved: () => void;
}) {
  const requestId = useRef(crypto.randomUUID());
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  return (
    <Modal
      title="Vergangenes Training nachtragen"
      close={() => {
        if (!busy) close();
      }}
    >
      <form
        className="form-body"
        onSubmit={async (e) => {
          e.preventDefault();
          if (busy) return;
          const f = new FormData(e.currentTarget);
          setBusy(true);
          setError("");
          try {
            const response = await fetch("/api/team/backfills", {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({
                request_id: requestId.current,
                period_id: period.id,
                event_type: String(f.get("event_type")),
                title: String(f.get("title")),
                occurred_on: f.get("occurred_on") || null,
                duration_minutes: Math.round(Number(f.get("hours")) * 60),
                parent_note: String(f.get("parent_note")),
                internal_note: String(f.get("internal_note")),
                location_id: f.get("location_id") || null,
                trainer_id: f.get("trainer_id") || null,
                notify_parents: f.get("notify_parents") === "on",
              }),
            });
            const result = await response.json();
            if (!response.ok) throw new Error(result.error);
            saved();
          } catch (e) {
            setError(
              e instanceof Error ? e.message : "Nachtragung fehlgeschlagen.",
            );
          } finally {
            setBusy(false);
          }
        }}
      >
        <p>
          {period.product_name} ·{" "}
          {periodLabel(period.starts_at, period.ends_at)}
        </p>
        <p>
          Eine Nachtragung ergänzt einen Stempel. Die Trainingsstunden zählen
          zur absolvierten Trainingszeit.
        </p>
        <fieldset disabled={busy} className="backfill-fields">
          <label>
            Trainingsstunden (Pflichtfeld)
            <input
              name="hours"
              type="number"
              min="0.05"
              max="12"
              step="0.05"
              required
              placeholder="z. B. 1,5"
            />
          </label>
          <label>
            Elternnotiz (Pflichtfeld)
            <textarea
              name="parent_note"
              required
              minLength={3}
              maxLength={2000}
              rows={3}
              placeholder="Diese Information erscheint für Eltern und bei gewähltem E-Mail-Versand."
            />
          </label>
          <label>
            Interne Notiz (optional)
            <textarea
              name="internal_note"
              maxLength={2000}
              rows={2}
              placeholder="Nur für Coach/Admin. Wird niemals per E-Mail versendet."
            />
          </label>
          <details>
            <summary>Weitere Angaben (optional)</summary>
            <div className="form-grid">
              <label>
                Bezeichnung
                <input
                  name="title"
                  maxLength={120}
                  placeholder="Nachgetragen"
                />
              </label>
              <label>
                Trainingsdatum
                <input name="occurred_on" type="date" />
              </label>
              <label>
                Trainingsart
                <select
                  name="event_type"
                  defaultValue={
                    discipline === "athletics"
                      ? "Athletiktraining"
                      : "Gruppentraining"
                  }
                >
                  {discipline === "athletics" ? (
                    <option>Athletiktraining</option>
                  ) : (
                    <>
                      <option>Gruppentraining</option>
                      <option>Einzeltraining</option>
                      <option>Fördertraining</option>
                    </>
                  )}
                </select>
              </label>
              <label>
                Ort
                <select name="location_id">
                  <option value="">Nicht angegeben</option>
                  {data.locations.map((l) => (
                    <option key={l.id} value={l.id}>
                      {l.name}
                    </option>
                  ))}
                </select>
              </label>
              <label>
                Coach
                <select name="trainer_id">
                  <option value="">Nicht angegeben</option>
                  {data.trainers.map((t) => (
                    <option key={t.id} value={t.id}>
                      {t.name}
                    </option>
                  ))}
                </select>
              </label>
            </div>
          </details>
          <label className="checkbox-label">
            <input name="notify_parents" type="checkbox" /> Eltern per E-Mail
            über die Nachtragung informieren
          </label>
          <p className="muted">
            Die Nachricht enthält ausschließlich die Elternnotiz und wird für
            die zugeordneten aktiven Elternkonten vorgemerkt. Bestehende
            Versandsperren bleiben wirksam.
          </p>
          {error && <p role="alert">{error}</p>}
          <button className="primary-button" disabled={busy}>
            {busy ? "Wird gespeichert …" : "Eine Einheit nachtragen"}
          </button>
        </fieldset>
      </form>
    </Modal>
  );
}

"use client";
import { useState } from "react";
import type { BookingOption } from "@/lib/camps/booking-option";
import type { Camp } from "@/lib/camps/domain";
import { CampError, campApi } from "./shared";
export function CampBookingOptionFields({
  value,
  onChange,
  disabled = false,
}: {
  value: BookingOption | null;
  onChange: (value: BookingOption | null) => void;
  disabled?: boolean;
}) {
  const patch = (change: Partial<BookingOption>) =>
    onChange({ ...value!, ...change });
  return (
    <fieldset className="camp-booking-option-fields" disabled={disabled}>
      <label className="camp-option-toggle">
        <input
          type="checkbox"
          checked={!!value}
          onChange={(e) =>
            onChange(
              e.target.checked
                ? { amount: 0, title: "", description: "", alert: "" }
                : null,
            )
          }
        />
        Buchungsoption aktivieren
      </label>
      {value && (
        <div className="camp-grid">
          <p>
            Bei Auswahl ersetzt der Optionspreis den normalen Camppreis.
            Bestehende Rabatte gelten weiterhin. Shop und Camp-Buchungslink
            übernehmen die Option automatisch.
          </p>
          <label>
            Options-Preis in Euro
            <input
              type="number"
              min="0.50"
              max="100000"
              step="0.01"
              required
              value={value.amount ? value.amount / 100 : ""}
              onChange={(e) =>
                patch({ amount: Math.round(Number(e.target.value) * 100) })
              }
            />
          </label>
          <label>
            Options-Titel
            <input
              required
              minLength={2}
              maxLength={160}
              value={value.title}
              onChange={(e) => patch({ title: e.target.value })}
            />
          </label>
          <label>
            Options-Beschreibung
            <textarea
              maxLength={3000}
              value={value.description}
              onChange={(e) => patch({ description: e.target.value })}
            />
          </label>
          <label>
            Options-Alert
            <textarea
              required
              maxLength={3000}
              value={value.alert}
              onChange={(e) => patch({ alert: e.target.value })}
            />
            <small>
              Dieser Hinweis erscheint vor der Buchung der ausgewählten Option
              als Popup.
            </small>
          </label>
        </div>
      )}
    </fieldset>
  );
}
export function CampBookingOptionEditor({
  camp,
  onChanged,
}: {
  camp: Camp;
  onChanged: () => Promise<void>;
}) {
  const [benefits, setBenefits] = useState(
    camp.member_benefits_enabled === true,
  );
  const [value, setValue] = useState(camp.booking_option ?? null),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(""),
    [saved, setSaved] = useState(false);
  return (
    <details className="camp-details">
      <summary>Buchungsoption bearbeiten</summary>
      <form
        className="camp-form"
        onSubmit={async (event) => {
          event.preventDefault();
          setBusy(true);
          setError("");
          setSaved(false);
          try {
            await campApi("booking-option", {
              camp_id: camp.id,
              booking_option: value,
              member_benefits_enabled: benefits,
              expected_version: camp.booking_option_version ?? 0,
            });
            await onChanged();
            setSaved(true);
          } catch (e) {
            setError((e as Error).message);
          } finally {
            setBusy(false);
          }
        }}
      >
        <label>
          Gelten Abo-Vorteile?
          <select
            value={String(benefits)}
            disabled={busy}
            onChange={(e) => setBenefits(e.target.value === "true")}
          >
            <option value="false">Nein</option>
            <option value="true">Ja</option>
          </select>
        </label>
        <CampBookingOptionFields
          value={value}
          onChange={(v) => {
            setValue(v);
            setSaved(false);
          }}
          disabled={busy}
        />
        <CampError message={error} />
        {saved && <p role="status">Buchungsoption gespeichert.</p>}
        <button className="primary-button" disabled={busy}>
          {busy ? "Wird gespeichert …" : "Buchungsoption speichern"}
        </button>
      </form>
    </details>
  );
}

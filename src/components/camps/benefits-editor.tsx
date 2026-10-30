"use client";
import { useState } from "react";
import { BadgePercent, Check, ChevronRight, LoaderCircle } from "lucide-react";
import { campApi } from "./api-client";

type Plan = {
  id: string;
  name: string;
  generation: string;
  billing_interval: string;
  camp_benefit_percent: number | null;
};
function BenefitRow({ plan }: { plan: Plan }) {
  const [value, setValue] = useState(plan.camp_benefit_percent),
    [state, setState] = useState<"idle" | "saving" | "saved" | "error">("idle"),
    [error, setError] = useState("");
  const label = `${plan.name} · ${{ legacy: "Bestandstarif", current: "Aktueller Tarif", special: "Sondertarif" }[plan.generation] ?? plan.generation} · ${plan.billing_interval === "year" ? "Jahr" : "Monat"}`;
  async function save(percent: number | null) {
    setValue(percent);
    setState("saving");
    setError("");
    try {
      const result = await campApi("benefit", { id: plan.id, percent });
      setValue(result.percent);
      setState("saved");
    } catch (e) {
      setError((e as Error).message);
      setState("error");
    }
  }
  return (
    <div className="camp-benefit-row">
      <label className="camp-plan">
        <span>
          <strong>{plan.name}</strong>
          <small>{label.slice(plan.name.length + 3)}</small>
        </span>
        <select
          aria-label={label}
          disabled={state === "saving"}
          value={value ?? ""}
          onChange={(e) =>
            void save(e.target.value ? Number(e.target.value) : null)
          }
        >
          <option value="">Kein Vorteil</option>
          {[10, 15, 20].map((n) => (
            <option key={n} value={n}>
              {n} % Camp-Vorteil
            </option>
          ))}
        </select>
      </label>
      <div
        className="camp-benefit-status"
        data-state={state}
        role={state === "error" ? "alert" : "status"}
      >
        {state === "saving" ? (
          <>
            <LoaderCircle size={13} className="camp-benefit-spin" /> Wird
            gespeichert …
          </>
        ) : state === "saved" ? (
          <>
            <Check size={13} /> Gespeichert
          </>
        ) : state === "error" ? (
          <>
            {error}{" "}
            <button
              type="button"
              className="text-button"
              onClick={() => void save(value)}
            >
              Erneut speichern
            </button>
          </>
        ) : (
          "Auswahl wird automatisch gespeichert"
        )}
      </div>
    </div>
  );
}
export function CampBenefitsEditor({ plans }: { plans: Plan[] }) {
  return (
    <details className="camp-panel camp-details camp-settings-panel camp-benefits-editor">
      <summary className="camp-settings-summary">
        <span className="camp-settings-icon">
          <BadgePercent size={21} />
        </span>
        <span className="camp-settings-title">
          <strong>Camp-Vorteile der Abo-Tarife</strong>
          <small>
            Persönliche Vorteile verwalten · automatisch gespeichert
          </small>
        </span>
        <span className="camp-settings-count">{plans.length}</span>
        <ChevronRight size={17} className="camp-settings-chevron" />
      </summary>
      <p>
        Der Abo-Vorteil gilt zusätzlich zum Frühbucherpreis. Bei mehreren
        aktiven Abos eines Kindes zählt der höchste Vorteil.
      </p>
      <div className="camp-benefits-list">
        {[...plans]
          .sort(
            (a, b) =>
              a.name.localeCompare(b.name, "de") ||
              a.generation.localeCompare(b.generation) ||
              a.billing_interval.localeCompare(b.billing_interval) ||
              a.id.localeCompare(b.id),
          )
          .map((plan) => (
            <BenefitRow key={plan.id} plan={plan} />
          ))}
      </div>
    </details>
  );
}

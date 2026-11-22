"use client";
// Design 2026: Schalter „Team / Art“ für Aufschlüsselungen in Sheets
// (Zentrale „Spieler gesamt“, Elternprofile „Familien“). Die Wahl wird pro
// Gerät gemerkt und gilt für beide Stellen.
import { useEffect, useState } from "react";

export type TeamKind = "team" | "kind";
const KEY = "d26-players-split-v1";

export function useTeamKind() {
  const [value, setValue] = useState<TeamKind>("team");
  // Erst nach dem Einhängen lesen, damit Server- und Browser-HTML gleich sind.
  useEffect(() => {
    try {
      if (localStorage.getItem(KEY) === "kind") setValue("kind");
    } catch {
      /* Kein Speicher: Team bleibt. */
    }
  }, []);
  const set = (v: TeamKind) => {
    setValue(v);
    try {
      localStorage.setItem(KEY, v);
    } catch {
      /* Ohne Speicher gilt die Wahl nur bis zum Neuladen. */
    }
  };
  return [value, set] as const;
}

export function TeamKindSwitch({
  value,
  onChange,
}: {
  value: TeamKind;
  onChange: (v: TeamKind) => void;
}) {
  return (
    <div className="d26-segments is-small d26-split-switch" role="tablist">
      {(
        [
          ["team", "Team"],
          ["kind", "Art"],
        ] as const
      ).map(([v, label]) => (
        <button
          key={v}
          type="button"
          role="tab"
          aria-selected={value === v}
          className={value === v ? "is-active" : ""}
          onClick={() => onChange(v)}
        >
          {label}
        </button>
      ))}
    </div>
  );
}

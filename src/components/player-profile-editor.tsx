"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { Modal } from "./portal";
import { api } from "./team";
import type { ProfileChild } from "@/lib/parent-profile";
export type EditablePlayer = Pick<
  ProfileChild,
  | "id"
  | "first_name"
  | "last_name"
  | "birth_year"
  | "team"
  | "gender"
  | "club"
  | "position"
  | "strong_foot"
  | "height_cm"
  | "development_goals"
>;
export function PlayerProfileEditor({ player }: { player: EditablePlayer }) {
  const router = useRouter();
  const [open, setOpen] = useState(false),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(""),
    [saved, setSaved] = useState(false);
  return (
    <>
      <button
        type="button"
        className="secondary-button"
        onClick={() => {
          setError("");
          setSaved(false);
          setOpen(true);
        }}
      >
        Angaben des Kindes bearbeiten
      </button>
      {saved && <p role="status">Angaben gespeichert.</p>}
      {open && (
        <Modal
          title="Angaben des Kindes bearbeiten"
          close={() => {
            if (!busy) setOpen(false);
          }}
        >
          <form
            className="form-body"
            onSubmit={async (e) => {
              e.preventDefault();
              if (busy) return;
              const form = new FormData(e.currentTarget);
              setBusy(true);
              setError("");
              try {
                await api("admin/player-profile", {
                  child_id: player.id,
                  first_name: String(form.get("first_name")),
                  last_name: String(form.get("last_name")),
                  birth_year: form.get("birth_year")
                    ? Number(form.get("birth_year"))
                    : null,
                  team: String(form.get("team") ?? ""),
                  gender: form.get("gender") || null,
                  club: String(form.get("club") ?? ""),
                  position: String(form.get("position") ?? ""),
                  strong_foot: form.get("strong_foot") || null,
                  height_cm: form.get("height_cm")
                    ? Number(form.get("height_cm"))
                    : null,
                  development_goals: String(
                    form.get("development_goals") ?? "",
                  ),
                });
                setOpen(false);
                setSaved(true);
                router.refresh();
              } catch (e) {
                setError(
                  e instanceof Error ? e.message : "Speichern fehlgeschlagen.",
                );
              } finally {
                setBusy(false);
              }
            }}
          >
            <p>
              Diese Angaben werden im Kinderprofil gespeichert und gelten auch
              in der Spielerliste und der Spieler-API.
            </p>
            <fieldset disabled={busy} className="player-editor-fields">
              <label>
                Vorname
                <input
                  name="first_name"
                  required
                  maxLength={100}
                  defaultValue={player.first_name}
                />
              </label>
              <label>
                Nachname
                <input
                  name="last_name"
                  required
                  maxLength={100}
                  defaultValue={player.last_name}
                />
              </label>
              <label>
                Geburtsjahr
                <input
                  name="birth_year"
                  type="number"
                  min={1990}
                  max={2100}
                  defaultValue={player.birth_year ?? ""}
                />
              </label>
              <label>
                Altersklasse
                <input name="team" maxLength={40} defaultValue={player.team} />
              </label>
              <p className="profile-muted">
                Die folgenden Angaben sind freiwillig und können jederzeit
                wieder entfernt werden.
              </p>
              <label>
                Geschlecht (optional)
                <select name="gender" defaultValue={player.gender ?? ""}>
                  <option value="">Keine Angabe</option>
                  <option value="männlich">Männlich</option>
                  <option value="weiblich">Weiblich</option>
                  <option value="divers">Divers</option>
                </select>
              </label>
              <label>
                Verein (optional)
                <input
                  name="club"
                  maxLength={120}
                  defaultValue={player.club ?? ""}
                />
              </label>
              <label>
                Position (optional)
                <input
                  name="position"
                  maxLength={80}
                  placeholder="z. B. Mittelfeld oder Torwart"
                  defaultValue={player.position ?? ""}
                />
              </label>
              <label>
                Starker Fuß (optional)
                <select
                  name="strong_foot"
                  defaultValue={player.strong_foot ?? ""}
                >
                  <option value="">Keine Angabe</option>
                  <option value="rechts">Rechts</option>
                  <option value="links">Links</option>
                  <option value="beidfüßig">Beidfüßig</option>
                </select>
              </label>
              <label>
                Größe in cm (optional)
                <input
                  name="height_cm"
                  type="number"
                  min={50}
                  max={250}
                  step={1}
                  defaultValue={player.height_cm ?? ""}
                />
              </label>
              <label>
                Entwicklungsziele (optional)
                <textarea
                  name="development_goals"
                  rows={4}
                  maxLength={2000}
                  placeholder="Was möchte dein Kind im Training verbessern?"
                  defaultValue={player.development_goals ?? ""}
                />
              </label>
            </fieldset>
            {error && (
              <p role="alert" className="error-message">
                {error}
              </p>
            )}
            <button className="primary-button" disabled={busy}>
              {busy ? "Wird gespeichert …" : "Änderungen speichern"}
            </button>
          </form>
        </Modal>
      )}
    </>
  );
}

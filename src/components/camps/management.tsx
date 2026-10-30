"use client";
import { useState } from "react";
import Link from "next/link";
import {
  Archive,
  ArchiveRestore,
  CalendarDays,
  ChevronRight,
  Trash2,
} from "lucide-react";
import { Modal } from "@/components/portal";
import type { Camp } from "@/lib/camps/domain";
import { CampError, campApi, date } from "./shared";

type ManagedCamp = Camp & { occupied?: number };
type ActionsProps = {
  camp: ManagedCamp;
  admin: boolean;
  linked: boolean;
  onChanged: (deleted?: boolean) => Promise<void>;
};
export function CampManagementActions({
  camp,
  admin,
  linked,
  onChanged,
}: ActionsProps) {
  const [busy, setBusy] = useState(""),
    [error, setError] = useState(""),
    [confirm, setConfirm] = useState(false);
  const archived = camp.status === "archived";
  const deleteReason =
    camp.status !== "draft"
      ? "Löschen ist nur für ungenutzte Entwürfe möglich."
      : linked
        ? "Für dieses Camp bestehen bereits Buchungen oder Zahlungsangebote. Bitte archivieren."
        : "";
  async function run(operation: "archive" | "restore" | "delete") {
    setBusy(operation);
    setError("");
    try {
      await campApi(operation === "delete" ? "delete" : "status", {
        id: camp.id,
        ...(operation === "delete"
          ? {}
          : { status: operation === "archive" ? "archived" : "closed" }),
      });
      setConfirm(false);
      await onChanged(operation === "delete");
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy("");
    }
  }
  return (
    <div className="camp-management">
      <div className="camp-management-buttons">
        <button
          type="button"
          className="camp-glass-button"
          disabled={!!busy}
          onClick={() => void run(archived ? "restore" : "archive")}
        >
          {archived ? <ArchiveRestore size={16} /> : <Archive size={16} />}
          {busy === "archive"
            ? "Wird archiviert …"
            : busy === "restore"
              ? "Wird zurückgeholt …"
              : archived
                ? "Aus Archiv holen"
                : "Camp archivieren"}
        </button>
        {admin && (
          <button
            type="button"
            className="camp-glass-button camp-delete-button"
            disabled={!!busy || !!deleteReason}
            title={deleteReason || "Ungenutzten Entwurf löschen"}
            onClick={() => {
              setError("");
              setConfirm(true);
            }}
          >
            <Trash2 size={15} /> Camp löschen
          </button>
        )}
      </div>
      {admin && deleteReason && (
        <small className="camp-management-note">{deleteReason}</small>
      )}
      {archived && (
        <small className="camp-management-note">
          Zurückgeholte Camps bleiben zunächst für neue Anmeldungen geschlossen.
        </small>
      )}
      {!confirm && <CampError message={error} />}
      {confirm && (
        <Modal
          title="Camp-Entwurf löschen?"
          className="camp-delete-modal"
          close={() => {
            if (!busy) setConfirm(false);
          }}
        >
          <div className="camp-delete-content">
            <div className="camp-delete-icon">
              <Trash2 size={25} />
            </div>
            <p>
              <strong>{camp.title}</strong> wird endgültig gelöscht. Das ist nur
              für ungenutzte Entwürfe ohne Buchungen und Zahlungsdaten möglich.
            </p>
            <CampError message={error} />
            <div className="camp-management-buttons">
              <button
                type="button"
                className="camp-glass-button"
                disabled={!!busy}
                onClick={() => setConfirm(false)}
              >
                Abbrechen
              </button>
              <button
                type="button"
                className="camp-glass-button camp-delete-button"
                disabled={!!busy}
                onClick={() => void run("delete")}
              >
                {busy ? "Wird gelöscht …" : "Entwurf endgültig löschen"}
              </button>
            </div>
          </div>
        </Modal>
      )}
    </div>
  );
}

export function CampArchive({
  camps,
  admin,
  linkedIds,
  onChanged,
}: {
  camps: ManagedCamp[];
  admin: boolean;
  linkedIds: string[];
  onChanged: () => Promise<void>;
}) {
  return (
    <details className="camp-panel camp-details camp-settings-panel camp-archive">
      <summary className="camp-settings-summary">
        <span className="camp-settings-icon">
          <Archive size={21} />
        </span>
        <span className="camp-settings-title">
          <strong>Archivierte Camps</strong>
          <small>Vergangene Camps und Buchungen aufbewahren</small>
        </span>
        <span className="camp-settings-count">{camps.length}</span>
        <ChevronRight size={17} className="camp-settings-chevron" />
      </summary>
      {camps.length ? (
        <div className="camp-archive-list">
          {camps.map((camp) => (
            <article className="camp-archive-card" key={camp.id}>
              <div className="camp-archive-heading">
                <span className="camp-archive-calendar">
                  <CalendarDays size={20} />
                </span>
                <div>
                  <h3>{camp.title}</h3>
                  <p>{camp.location}</p>
                </div>
                <span className="camp-archive-badge">Archiviert</span>
              </div>
              <p className="camp-archive-date">
                {date(camp.days[0].starts_at)}
                {camp.occupied != null
                  ? ` · ${camp.occupied} gebuchte Plätze`
                  : ""}
              </p>
              <Link className="camp-archive-link" href={`/camps/${camp.id}`}>
                Camp ansehen <ChevronRight size={14} />
              </Link>
              <CampManagementActions
                camp={camp}
                admin={admin}
                linked={linkedIds.includes(camp.id)}
                onChanged={() => onChanged()}
              />
            </article>
          ))}
        </div>
      ) : (
        <div className="camp-archive-empty">
          <Archive size={28} />
          <strong>Dein Archiv ist noch leer</strong>
          <p>
            Archivierte Camps erscheinen hier mit ihren vorhandenen Buchungen.
          </p>
        </div>
      )}
    </details>
  );
}

"use client";
// Gemeinsame Markierungen für Glocke und Aktivitäten: Erledigt, Ignorieren,
// In 7 Tagen erinnern. Gespeichert in der Datenbank (Release 050), damit alle
// Admins und Geräte denselben Stand sehen. Fehlt die Tabelle noch, merkt sich
// dieser Browser die Markierung lokal.
import { useCallback, useEffect, useState } from "react";
import { noticeHidden, type NoticeDecision } from "@/lib/notice-decisions";

export type DecisionState = NoticeDecision["state"] | "open";
type Map = Record<string, NoticeDecision>;

const LOCAL = "d26-decisions-local";
const EVENT = "d26-decisions";
const DAY = 86400000;

let shared: { map: Map; available: boolean; at: number } | null = null;
/** Letzter Speicherfehler: die Markierung gilt dann nur in diesem Browser. */
let failed = "";
/** Glocke lädt offene Vorgänge nach jeder Markierung neu. */
export const CHANGED = "d26-decisions-changed";
function dropActivityCache() {
  try {
    for (const k of Object.keys(sessionStorage))
      if (k.startsWith("d26-notify:/api/activities"))
        sessionStorage.removeItem(k);
  } catch {
    /* Egal. */
  }
}
let pending: Promise<void> | null = null;

function readLocal(): Map {
  try {
    return JSON.parse(localStorage.getItem(LOCAL) ?? "{}") ?? {};
  } catch {
    return {};
  }
}
function writeLocal(map: Map) {
  try {
    localStorage.setItem(LOCAL, JSON.stringify(map));
  } catch {
    /* Ohne Speicher gilt die Markierung bis zum Neuladen. */
  }
}

async function refresh(force = false) {
  if (!force && shared && Date.now() - shared.at < 60000) return;
  if (pending) return pending;
  pending = (async () => {
    try {
      const r = await fetch("/api/notice-decisions", { cache: "no-store" });
      const d = r.ok ? await r.json() : null;
      const map: Map = { ...readLocal() };
      if (d?.available)
        for (const row of d.rows as NoticeDecision[]) map[row.key] = row;
      shared = { map, available: !!d?.available, at: Date.now() };
    } catch {
      shared = { map: readLocal(), available: false, at: Date.now() };
    } finally {
      pending = null;
      window.dispatchEvent(new Event(EVENT));
    }
  })();
  return pending;
}

export const IN_7_DAYS = () => Date.now() + 7 * DAY;

/** Markierungen lesen und setzen; Glocke und Aktivitäten teilen denselben Stand. */
export function useDecisions(enabled = true) {
  const [, setTick] = useState(0);
  useEffect(() => {
    if (!enabled) return;
    const bump = () => setTick((n) => n + 1);
    window.addEventListener(EVENT, bump);
    void refresh();
    const focus = () => void refresh();
    window.addEventListener("focus", focus);
    return () => {
      window.removeEventListener(EVENT, bump);
      window.removeEventListener("focus", focus);
    };
  }, [enabled]);
  const map = shared?.map ?? {};
  const decide = useCallback(
    async (key: string, state: DecisionState, remindAt?: number) => {
      const next: Map = { ...(shared?.map ?? readLocal()) };
      if (state === "open") delete next[key];
      else
        next[key] = {
          key,
          state,
          remind_at:
            state === "snoozed" && remindAt
              ? new Date(remindAt).toISOString()
              : null,
          updated_at: new Date().toISOString(),
        };
      shared = {
        map: next,
        available: shared?.available ?? false,
        at: shared?.at ?? 0,
      };
      window.dispatchEvent(new Event(EVENT));
      try {
        const r = await fetch("/api/notice-decisions", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            key,
            state,
            ...(state === "snoozed" && remindAt
              ? { remindAt: new Date(remindAt).toISOString() }
              : {}),
          }),
        });
        if (!r.ok) throw Error(String(r.status));
        failed = "";
        // Gemeinsam gespeichert: lokale Kopie dieses Schlüssels aufräumen.
        const local = readLocal();
        if (local[key]) {
          delete local[key];
          writeLocal(local);
        }
      } catch {
        // Nicht gespeichert (offline, gesperrt oder nicht eingerichtet):
        // im Browser merken und das deutlich sagen.
        const local = readLocal();
        if (state === "open") delete local[key];
        else local[key] = next[key];
        writeLocal(local);
        failed =
          "Konnte nicht für alle gespeichert werden. Die Markierung gilt vorerst nur auf diesem Gerät.";
      } finally {
        dropActivityCache();
        window.dispatchEvent(new Event(EVENT));
        window.dispatchEvent(new Event(CHANGED));
      }
    },
    [],
  );
  return {
    map,
    available: (shared?.available ?? false) && !failed,
    error: failed,
    hidden: (key: string, now = Date.now()) => noticeHidden(map[key], now),
    decide,
  };
}

export function decisionLabel(d: NoticeDecision | undefined) {
  if (!d) return "";
  if (d.state === "done") return "Erledigt";
  if (d.state === "ignored") return "Ignoriert";
  return d.remind_at
    ? `Erinnert am ${new Date(d.remind_at).toLocaleDateString("de-DE", { day: "numeric", month: "short" })}`
    : "Zurückgestellt";
}

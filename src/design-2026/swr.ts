"use client";
// Design 2026: kleiner Zwischenspeicher nach „stale-while-revalidate“.
// Zuletzt geladene Werte erscheinen sofort, im Hintergrund wird still
// nachgeladen. Gleiche Schlüssel teilen sich eine Anfrage (keine Doppel-Ladung),
// und Kacheln können die Werte aller ihrer Chips vorab holen.
//
// Gespeichert wird im Speicher und im sessionStorage des Tabs, also nur in
// diesem Browser-Tab und nur bis er geschlossen wird. Beim Abmelden wird alles
// gelöscht (clearCached).
import { useCallback, useEffect, useSyncExternalStore } from "react";

type Entry = {
  data?: unknown;
  /** Zeitpunkt der letzten erfolgreichen Ladung (ms). */
  at: number;
  failed?: boolean;
  promise?: Promise<unknown>;
};

const PREFIX = "d26-swr:";
const entries = new Map<string, Entry>();
const listeners = new Map<string, Set<() => void>>();
const EMPTY: Entry = { at: 0 };

function notify(key: string) {
  listeners.get(key)?.forEach((l) => l());
}

function read(key: string): Entry {
  const hit = entries.get(key);
  if (hit) return hit;
  // Erst aus dem Tab-Speicher holen (z. B. nach dem Neuladen der Seite).
  try {
    const raw = sessionStorage.getItem(PREFIX + key);
    if (raw) {
      const parsed = JSON.parse(raw) as { t: number; d: unknown };
      const entry: Entry = { data: parsed.d, at: parsed.t };
      entries.set(key, entry);
      return entry;
    }
  } catch {
    /* Kein Speicher: nur im Arbeitsspeicher. */
  }
  entries.set(key, EMPTY);
  return EMPTY;
}

function write(key: string, entry: Entry) {
  entries.set(key, entry);
  notify(key);
}

function persist(key: string, data: unknown, at: number) {
  try {
    sessionStorage.setItem(PREFIX + key, JSON.stringify({ t: at, d: data }));
  } catch {
    /* Speicher voll oder gesperrt: bleibt im Arbeitsspeicher. */
  }
}

/** Aktuellen Stand lesen, ohne zu laden. */
export function peekCached<T>(key: string) {
  const e = read(key);
  return { data: e.data as T | undefined, at: e.at };
}

/** Lokal geänderte Daten (z. B. nach „Erledigt“) in den Speicher schreiben. */
export function setCached<T>(key: string, data: T) {
  const at = Date.now();
  write(key, { ...read(key), data, at, failed: false });
  persist(key, data, at);
}

/**
 * Lädt (oder hängt sich an eine laufende Ladung) und merkt das Ergebnis.
 * force startet immer eine neue Ladung, z. B. direkt nach dem Speichern;
 * eine ältere, später ankommende Antwort überschreibt sie dann nicht.
 */
export function loadCached<T>(
  key: string,
  loader: () => Promise<T>,
  { force = false }: { force?: boolean } = {},
): Promise<T> {
  const current = read(key);
  if (current.promise && !force) return current.promise as Promise<T>;
  const promise: Promise<T> = loader().then(
    (data) => {
      const latest = read(key).promise === promise;
      if (latest) {
        const at = Date.now();
        write(key, { data, at });
        persist(key, data, at);
      }
      return latest ? data : ((read(key).data as T | undefined) ?? data);
    },
    (error) => {
      const e = read(key);
      if (e.promise === promise)
        write(key, { data: e.data, at: e.at, failed: true });
      throw error;
    },
  );
  write(key, { ...current, promise });
  return promise;
}

/** Holt einen Wert vorab, wenn er fehlt oder älter als maxAge ist. */
export function prefetchCached<T>(
  key: string,
  loader: () => Promise<T>,
  maxAge = 30000,
) {
  const e = read(key);
  if (e.promise || (e.data !== undefined && Date.now() - e.at < maxAge)) return;
  loadCached(key, loader).catch(() => {
    /* Vorladen darf still scheitern, die Kachel lädt dann selbst. */
  });
}

/** Alles vergessen (beim Abmelden). */
export function clearCached() {
  entries.clear();
  try {
    for (let i = sessionStorage.length - 1; i >= 0; i--) {
      const k = sessionStorage.key(i);
      if (k?.startsWith(PREFIX) || k?.startsWith("d26-all:"))
        sessionStorage.removeItem(k);
    }
  } catch {
    /* Egal. */
  }
  listeners.forEach((_, key) => notify(key));
}

/**
 * Wert mit Zwischenspeicher: liefert sofort den zuletzt geladenen Stand und
 * lädt still nach, wenn er älter als maxAge ist. key = null lädt nichts.
 * delay verzögert nur die allererste Ladung ohne gespeicherten Wert (z. B.
 * beim Tippen in einer Suche).
 */
export function useCached<T>(
  key: string | null,
  loader: () => Promise<T>,
  { maxAge = 30000, delay = 0 }: { maxAge?: number; delay?: number } = {},
) {
  const subscribe = useCallback(
    (cb: () => void) => {
      if (!key) return () => {};
      let set = listeners.get(key);
      if (!set) listeners.set(key, (set = new Set()));
      set.add(cb);
      return () => {
        set!.delete(cb);
      };
    },
    [key],
  );
  const entry = useSyncExternalStore(
    subscribe,
    () => (key ? read(key) : EMPTY),
    () => EMPTY,
  );
  useEffect(() => {
    if (!key) return;
    const e = read(key);
    if (e.promise) return;
    const hasData = e.data !== undefined;
    if (hasData && Date.now() - e.at < maxAge) return;
    const run = () =>
      loadCached(key, loader).catch(() => {
        /* failed steht im Eintrag. */
      });
    if (hasData || !delay) {
      run();
      return;
    }
    const timer = setTimeout(run, delay);
    return () => clearTimeout(timer);
    // Der Loader hängt nur vom Schlüssel ab.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, maxAge, delay]);
  const refresh = useCallback(() => {
    if (!key) return Promise.resolve(undefined);
    const e = read(key);
    // Laufende Ladung abwarten, sonst neu laden.
    if (e.promise) return e.promise as Promise<T>;
    return loadCached(key, loader).catch(() => undefined);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);
  return {
    data: entry.data as T | undefined,
    /** Zeitpunkt des angezeigten Stands (0 = noch nie geladen). */
    at: entry.at,
    failed: !!entry.failed && entry.data === undefined,
    /** Lädt gerade (mit oder ohne angezeigten alten Stand). */
    loading: !!entry.promise,
    refresh,
  };
}

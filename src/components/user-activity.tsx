"use client";
import { useEffect, useState } from "react";
import { ACTIVITY_INTERVAL, activityStatus } from "@/lib/user-activity";

export function UserActivityHeartbeat() {
  useEffect(() => {
    const controller = new AbortController();
    let pending = false;
    let lastSuccess = 0;
    async function beat() {
      if (
        document.visibilityState !== "visible" ||
        pending ||
        Date.now() - lastSuccess < ACTIVITY_INTERVAL - 1000
      )
        return;
      pending = true;
      const sentAt = Date.now();
      try {
        const response = await fetch("/api/activity", {
          method: "POST",
          signal: AbortSignal.any([
            controller.signal,
            AbortSignal.timeout(15_000),
          ]),
        });
        if (response.ok) lastSuccess = sentAt;
      } catch {
        /* Presence must never interrupt portal use. */
      } finally {
        pending = false;
      }
    }
    void beat();
    const timer = setInterval(beat, ACTIVITY_INTERVAL);
    document.addEventListener("visibilitychange", beat);
    window.addEventListener("online", beat);
    return () => {
      controller.abort();
      clearInterval(timer);
      document.removeEventListener("visibilitychange", beat);
      window.removeEventListener("online", beat);
    };
  }, []);
  return null;
}

export function useUserActivity(ids: string[]) {
  const key = [...new Set(ids)].sort().join(",");
  const [snapshot, setSnapshot] = useState<{
    key: string;
    seen: Record<string, string | null>;
    offset: number;
  }>({ key: "", seen: {}, offset: 0 });
  const [clock, setClock] = useState(() => Date.now());
  useEffect(() => {
    if (!key) return;
    const controller = new AbortController();
    let pending = false;
    async function refresh() {
      if (document.visibilityState !== "visible" || pending) return;
      pending = true;
      try {
        const userIds = key.split(",");
        const seen: Record<string, string | null> = {};
        let offset = 0;
        for (let start = 0; start < userIds.length; start += 100) {
          const batch = userIds.slice(start, start + 100);
          const response = await fetch("/api/admin/user-activity", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ ids: batch }),
            cache: "no-store",
            signal: AbortSignal.any([
              controller.signal,
              AbortSignal.timeout(15_000),
            ]),
          });
          if (!response.ok) throw new Error("Activity unavailable");
          const result = await response.json();
          for (const id of batch) seen[id] = null;
          for (const row of result.rows) seen[row.user_id] = row.last_seen_at;
          offset = Date.parse(result.now) - Date.now();
        }
        if (!controller.signal.aborted) {
          setSnapshot({ key, seen, offset });
          setClock(Date.now());
        }
      } catch {
        /* Retain known timestamps; they still expire to offline. */
      } finally {
        pending = false;
      }
    }
    void refresh();
    const poll = setInterval(refresh, ACTIVITY_INTERVAL);
    const tick = setInterval(() => setClock(Date.now()), 15_000);
    document.addEventListener("visibilitychange", refresh);
    window.addEventListener("online", refresh);
    return () => {
      controller.abort();
      clearInterval(poll);
      clearInterval(tick);
      document.removeEventListener("visibilitychange", refresh);
      window.removeEventListener("online", refresh);
    };
  }, [key]);
  return {
    seen: snapshot.key === key ? snapshot.seen : {},
    now: clock + snapshot.offset,
  };
}

export function UserActivityStatus({
  lastSeen,
  now,
}: {
  lastSeen: string | null | undefined;
  now: number;
}) {
  const status = activityStatus(lastSeen, now);
  return (
    <span
      className={`user-activity-status${status.online ? " is-online" : ""}`}
      title={status.title}
    >
      <i aria-hidden="true" />
      {status.label}
    </span>
  );
}

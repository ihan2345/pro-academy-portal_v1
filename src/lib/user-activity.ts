export const ACTIVITY_INTERVAL = 60_000;
export const ONLINE_WINDOW = 120_000;

export function activityStatus(
  lastSeen: string | null | undefined,
  now: number,
) {
  const timestamp = lastSeen ? Date.parse(lastSeen) : NaN;
  if (!Number.isFinite(timestamp))
    return {
      online: false,
      label: "—",
      title:
        lastSeen === null
          ? "Noch keine Aktivität erfasst."
          : "Aktivitätsstatus nicht verfügbar.",
    };
  const age = Math.max(0, now - timestamp);
  const online = age < ONLINE_WINDOW;
  const label = online
    ? "Online"
    : age < 3_600_000
      ? `vor ${Math.floor(age / 60_000)} Min.`
      : age < 86_400_000
        ? `vor ${Math.floor(age / 3_600_000)} Std.`
        : `vor ${Math.floor(age / 86_400_000)} ${Math.floor(age / 86_400_000) === 1 ? "Tag" : "Tagen"}`;
  return {
    online,
    label,
    title: `Zuletzt aktiv: ${new Intl.DateTimeFormat("de-DE", {
      dateStyle: "medium",
      timeStyle: "medium",
      timeZone: "Europe/Berlin",
    }).format(timestamp)} (Europe/Berlin)`,
  };
}

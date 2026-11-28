// Online-Zeit (Release 065) als tt:hh:mm: Tage, Stunden, Minuten.
// Tage werden nicht auf 99 begrenzt; Stunden und Minuten immer zweistellig.
export function formatOnlineTime(seconds: number | null | undefined) {
  const total = Math.max(0, Math.floor((Number(seconds) || 0) / 60));
  const days = Math.floor(total / 1440);
  const hours = Math.floor((total % 1440) / 60);
  const minutes = total % 60;
  const two = (n: number) => String(n).padStart(2, "0");
  return `${two(days)}:${two(hours)}:${two(minutes)}`;
}

/** Ausgeschrieben für Hinweise, z. B. „1 Tag, 3 Std., 5 Min.“ */
export function spellOnlineTime(seconds: number | null | undefined) {
  const total = Math.max(0, Math.floor((Number(seconds) || 0) / 60));
  const days = Math.floor(total / 1440);
  const hours = Math.floor((total % 1440) / 60);
  const minutes = total % 60;
  const parts = [
    days ? `${days} ${days === 1 ? "Tag" : "Tage"}` : "",
    hours ? `${hours} Std.` : "",
    `${minutes} Min.`,
  ].filter(Boolean);
  return parts.join(", ");
}

export type OnlineRole = "parent" | "staff" | "admin" | "viewer";
export type OnlineRow = {
  user_id: string;
  name: string;
  role: OnlineRole;
  parent_id: string | null;
  online_seconds: number;
  last_seen_at: string | null;
  counted_since: string | null;
};
export type OnlineOverview = {
  now: string;
  counted_since: string | null;
  rows: OnlineRow[];
};

export const isTeamRole = (role: string) => role !== "parent";

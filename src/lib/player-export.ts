import { Temporal } from "@js-temporal/polyfill";
import { activeRanges, type ProfilePeriod } from "./parent-profile";
import { TIMEZONE } from "./domain";

/** Continuous active service: calendar anniversaries plus a remainder of >=10 days. */
export function exportActiveMonths(periods: ProfilePeriod[], now: string) {
  return activeRanges(periods, now).reduce((total, [start, end]) => {
    const anchor =
      Temporal.Instant.fromEpochMilliseconds(start).toZonedDateTimeISO(
        TIMEZONE,
      );
    const finish =
      Temporal.Instant.fromEpochMilliseconds(end).toZonedDateTimeISO(TIMEZONE);
    let months = Math.max(
      0,
      (finish.year - anchor.year) * 12 + finish.month - anchor.month,
    );
    if (Temporal.ZonedDateTime.compare(anchor.add({ months }), finish) > 0)
      months--;
    const remainder = anchor.add({ months });
    return (
      total +
      months +
      (Temporal.ZonedDateTime.compare(remainder.add({ days: 10 }), finish) <= 0
        ? 1
        : 0)
    );
  }, 0);
}

export interface ExportPlayer {
  id: string;
  spielername: string;
  elternteile: string[];
  geburtsjahr: number | null;
  geschlecht: string | null;
  verein: string | null;
  position: string | null;
  fuss: string | null;
  groesse_cm: number | null;
  entwicklungsziele: string | null;
  archiviert: boolean;
  abos: { art: string; von: string; bis: string }[];
  aktive_monate: number;
  profil_link: string;
}

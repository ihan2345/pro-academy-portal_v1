// Archiv „Alle Spieler“: jedes jemals erfasste Kind mit genau einem Status.
// Reihenfolge der Regeln: laufendes Abo > nur Camp > nur Probetraining > inaktiv.
export type ArchiveStatus = "abo" | "camp" | "trial" | "inactive";
export type ArchiveTheme = "black" | "purple" | "neon" | "neutral";

export interface ArchivePlayer {
  id: string;
  name: string;
  first_name: string;
  last_name: string;
  age: string;
  team: string;
  archived: boolean;
  created: string;
  status: ArchiveStatus;
  /** Laufende Abo-Produkte (nur bei Status „abo“). */
  products: string[];
  /** Alle jemals gebuchten Abo-Produkte. */
  formerProducts: string[];
  months: number;
  since: string | null;
  trainings: number;
  minutes: number;
  camps: number | null;
  trial: string | null;
  parents: { id: string; name: string }[];
  /** Nur Probetraining-Kind (trial_players, noch nicht übernommen): kein Spielerprofil. */
  trialOnly?: boolean;
}
export interface ArchivePage {
  rows: ArchivePlayer[];
  trainingAvailable: boolean;
}

export const ARCHIVE_STATUSES: {
  value: ArchiveStatus;
  label: string;
  short: string;
}[] = [
  { value: "abo", label: "Aktives Abo", short: "Abo" },
  { value: "camp", label: "Nur Camp", short: "Camp" },
  { value: "trial", label: "Probetraining", short: "Probetraining" },
  { value: "inactive", label: "Inaktiv", short: "Inaktiv" },
];

export function archiveStatus(input: {
  activeSubscription: boolean;
  hadSubscription: boolean;
  camps: number;
  trial: boolean;
}): ArchiveStatus {
  if (input.activeSubscription) return "abo";
  if (input.hadSubscription) return "inactive";
  if (input.camps > 0) return "camp";
  if (input.trial) return "trial";
  return "inactive";
}

export const TRIAL_LABELS: Record<string, string> = {
  new: "Angefragt",
  contacted: "Kontaktiert",
  planned: "Geplant",
  attended: "Teilgenommen",
  closed: "Abgeschlossen",
};

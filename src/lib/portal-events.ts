/** Ereignis für die Glocken-Kategorie „Portal“ (Release 064). */
export type PortalAccessEvent = {
  kind:
    | "invite_sent"
    | "invite_failed"
    | "invite_accepted"
    | "self_activated"
    | "login"
    | "online";
  at: string;
  user_id: string | null;
  parent_id: string | null;
  name: string | null;
  role: string | null;
  wave: boolean;
  test: boolean;
  first: boolean;
};

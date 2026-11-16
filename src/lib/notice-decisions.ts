export type NoticeDecision = {
  key: string;
  state: "done" | "ignored" | "snoozed";
  remind_at: string | null;
  updated_at?: string;
};
/** Ausgeblendet: erledigt, ignoriert oder noch zurückgestellt. */
export function noticeHidden(d: NoticeDecision | undefined, now: number) {
  if (!d) return false;
  if (d.state !== "snoozed") return true;
  return !!d.remind_at && Date.parse(d.remind_at) > now;
}

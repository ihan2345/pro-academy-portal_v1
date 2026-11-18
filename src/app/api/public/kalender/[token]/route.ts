import { icsFile } from "@/lib/mail-2026/calendar";
import { verifyCalendarToken } from "@/lib/mail-2026/ics-link";

export const dynamic = "force-dynamic";
const base = {
  "Cache-Control": "private, no-store",
  "X-Robots-Tag": "noindex, nofollow",
  "Referrer-Policy": "no-referrer",
};

/** Kalender-Button aus Termin-Mails: liefert die signierte .ics-Datei. */
export async function GET(
  _request: Request,
  context: { params: Promise<{ token: string }> },
) {
  const { token } = await context.params;
  const event = await verifyCalendarToken(decodeURIComponent(token));
  if (!event)
    return new Response(
      "Dieser Kalender-Link ist ungültig oder abgelaufen.",
      {
        status: 404,
        headers: { ...base, "Content-Type": "text/plain; charset=utf-8" },
      },
    );
  return new Response(icsFile(event), {
    headers: {
      ...base,
      "Content-Type": "text/calendar; charset=utf-8",
      "Content-Disposition": 'inline; filename="ProAcademy-Termin.ics"',
    },
  });
}

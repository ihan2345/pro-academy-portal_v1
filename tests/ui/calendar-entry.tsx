import React from "react";
import { createRoot } from "react-dom/client";
import { Portal } from "../../src/components/portal";
import { portalFixture } from "../fixtures/portal";
import { calendarDate, addMonths, monthStart } from "../../src/lib/calendar";
import { calculateAutoAttendanceAt, localToUtc } from "../../src/lib/domain";

const today = calendarDate();
const next = addMonths(today, 1).slice(0, 8) + "05";
const events = Array.from({ length: 16 }, (_, index) => {
  const starts_at = localToUtc(
    today,
    `${String(6 + index).padStart(2, "0")}:00`,
  );
  const ends_at = new Date(Date.parse(starts_at) + 3600000).toISOString();
  return {
    ...portalFixture.events[0],
    id: `day-${index}`,
    starts_at,
    ends_at,
    auto_attendance_at: calculateAutoAttendanceAt(ends_at),
    title: index === 0 ? "Technik & Spielintelligenz" : `Training ${index + 1}`,
    status: index === 1 ? "cancelled" : "scheduled",
  };
});
events.push({
  ...events[0],
  id: "next-month",
  title: "Training im Folgemonat",
  starts_at: localToUtc(next, "16:00"),
  ends_at: localToUtc(next, "17:00"),
  auto_attendance_at: calculateAutoAttendanceAt(localToUtc(next, "17:00")),
});
// A UTC date in the previous month belongs to the next month's first Berlin day.
events.push({
  ...events[0],
  id: "midnight",
  title: "Später Termin",
  starts_at: localToUtc(addMonths(today, 1), "00:30"),
  ends_at: localToUtc(addMonths(today, 1), "01:30"),
  auto_attendance_at: calculateAutoAttendanceAt(
    localToUtc(addMonths(today, 1), "01:30"),
  ),
});
window.sessionStorage.setItem(
  "calendar-test",
  JSON.stringify({ today, next, month: monthStart(today) }),
);
createRoot(document.getElementById("root")!).render(
  <Portal
    initial={
      new URLSearchParams(window.location.search).has("grace")
        ? {
            ...portalFixture,
            role: "staff",
            events: [],
            players: [
              {
                ...portalFixture.players[0],
                first_name: "Levin",
                last_name: "Günes",
              },
            ],
            periods: [
              {
                ...portalFixture.periods[0],
                starts_at: "2026-09-07T12:40:49Z",
                ends_at: "2026-10-07T12:40:49Z",
              },
            ],
          }
        : { ...portalFixture, role: "staff", events }
    }
    section="team"
  />,
);

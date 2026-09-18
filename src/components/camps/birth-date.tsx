"use client";
import { useState } from "react";

// Legacy profiles contain a year, not a complete date. Keep the year and ask only for missing parts.
export function StoredYearBirthDate({
  year,
  onChange,
}: {
  year: number;
  onChange: (value: string) => void;
}) {
  const [day, setDay] = useState("");
  const [month, setMonth] = useState("");
  const days = (m: string) =>
    m ? new Date(Date.UTC(year, Number(m), 0)).getUTCDate() : 31;
  function change(nextDay: string, nextMonth: string) {
    if (Number(nextDay) > days(nextMonth)) nextDay = "";
    setDay(nextDay);
    setMonth(nextMonth);
    onChange(
      nextDay && nextMonth
        ? `${year}-${nextMonth.padStart(2, "0")}-${nextDay.padStart(2, "0")}`
        : "",
    );
  }
  return (
    <fieldset className="camp-birth-date">
      <legend>Geburtsdatum</legend>
      <div className="camp-birth-date-parts">
        <label>
          Tag
          <select
            required
            value={day}
            onChange={(e) => change(e.target.value, month)}
          >
            <option value="">Tag</option>
            {Array.from({ length: days(month) }, (_, i) => i + 1).map((d) => (
              <option key={d} value={d}>
                {d}
              </option>
            ))}
          </select>
        </label>
        <label>
          Monat
          <select
            required
            value={month}
            onChange={(e) => change(day, e.target.value)}
          >
            <option value="">Monat</option>
            {Array.from({ length: 12 }, (_, i) => i + 1).map((m) => (
              <option key={m} value={m}>
                {m}
              </option>
            ))}
          </select>
        </label>
        <label>
          Jahr
          <input value={year} readOnly />
        </label>
      </div>
      <small>Geburtsjahr übernommen. Bitte Tag und Monat ergänzen.</small>
    </fieldset>
  );
}

"use client";
import Link from "next/link";
import { createContext, useContext } from "react";
const CampLoginContext = createContext("/login");
export const CampLoginProvider = CampLoginContext.Provider;
export function useCampLogin() {
  return useContext(CampLoginContext);
}
import { Brand } from "@/components/portal";
export async function campApi(path: string, body?: unknown) {
  const r = await fetch(
    `/api/camp/${path}`,
    body === undefined
      ? { cache: "no-store" }
      : {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(body),
        },
  );
  if (!r.headers.get("content-type")?.includes("application/json"))
    throw new Error(
      "Die Camp-Seite wird gerade neu geladen. Bitte erneut versuchen.",
    );
  const data = await r.json();
  if (!r.ok) throw new Error(data.error ?? "Anfrage fehlgeschlagen.");
  return data;
}
export function CampFrame({ children }: { children: React.ReactNode }) {
  const loginHref = useCampLogin();
  return (
    <main className="camp-page">
      <header className="camp-top">
        <Link href="/camps">
          <Brand />
        </Link>
        <Link href={loginHref}>Kundenzugang</Link>
      </header>
      <div className="camp-content">{children}</div>
      <footer>ProAcademy by Ayhan & Karaman</footer>
    </main>
  );
}
export function CampError({ message }: { message: string }) {
  return message ? (
    <p className="camp-error" role="alert">
      {message}
    </p>
  ) : null;
}
export function date(value: string) {
  return new Intl.DateTimeFormat("de-DE", {
    timeZone: "Europe/Berlin",
    dateStyle: "medium",
    timeStyle: "short",
  }).format(new Date(value));
}

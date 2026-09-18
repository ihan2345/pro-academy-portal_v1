"use client";
import Link from "next/link";
import { createContext, useContext } from "react";
const CampLoginContext = createContext("/login");
export const CampLoginProvider = CampLoginContext.Provider;
export function useCampLogin() {
  return useContext(CampLoginContext);
}
import { Brand } from "@/components/portal";
export { campApi } from "./api-client";
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

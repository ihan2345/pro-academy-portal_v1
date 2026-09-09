"use client";
import Link from "next/link";
export default function Error({
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return (
    <main className="auth-page">
      <section className="auth-card">
        <h1>Kurze Trainingspause.</h1>
        <p>
          Dein Portal konnte gerade nicht geladen werden. Bitte versuche es
          erneut. Bei einem neuen Testsystem müssen die Verbindungen zunächst
          eingerichtet werden.
        </p>
        <button className="primary-button" onClick={reset}>
          Erneut versuchen
        </button>
        <Link className="auth-demo-link" href="/login">
          Zur Anmeldung
        </Link>
      </section>
    </main>
  );
}

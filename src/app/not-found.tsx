import Link from "next/link";
export default function NotFound() {
  return (
    <main className="auth-page">
      <section className="auth-card">
        <h1>Hier ist kein Training.</h1>
        <p>Diese Seite gibt es nicht oder sie wurde verschoben.</p>
        <Link className="primary-button" href="/">
          Zur Übersicht
        </Link>
      </section>
    </main>
  );
}

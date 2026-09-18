"use client";
import { useEffect, useState } from "react";
import Link from "next/link";
import { CampFrame, CampError, campApi, useCampLogin } from "./shared";
export function BookingResult({ sessionId }: { sessionId: string }) {
  const loginHref = useCampLogin();
  const [result, setResult] = useState<{
      status: string;
      booking_id: string;
      camp_id: string;
    } | null>(null),
    [error, setError] = useState(""),
    [message, setMessage] = useState(""),
    [busy, setBusy] = useState(false);
  async function check() {
    setBusy(true);
    setError("");
    try {
      setResult(await campApi("confirm", { session_id: sessionId }));
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  useEffect(() => {
    if (sessionId) void check();
    else setError("Zahlungsreferenz fehlt.");
  }, [sessionId]);
  return (
    <CampFrame>
      <section className="camp-panel">
        <h1>
          {result?.status === "paid"
            ? "Dein Kind ist dabei."
            : result?.status === "review"
              ? "Zahlung eingegangen."
              : result?.status === "refunded"
                ? "Buchung erstattet."
                : "Zahlung prüfen."}
        </h1>
        <p>
          {result?.status === "paid"
            ? "Deine Zahlung ist eingegangen und der Camp-Platz ist bestätigt."
            : result?.status === "review"
              ? "Die Zahlung ist gespeichert. Die Academy muss die Zuordnung oder Platzvergabe noch klären. Es ist noch kein Platz bestätigt."
              : result?.status === "refunded"
                ? "Die Zahlung wurde vollständig erstattet. Diese Buchung belegt keinen Camp-Platz mehr."
                : "Deine Buchung ist abgeschlossen, sobald die Zahlung bestätigt wurde."}
        </p>
        <CampError message={error} />
        {busy && <p>Zahlung wird geprüft …</p>}
        {(!result || result.status === "pending") && (
          <button className="primary-button" disabled={busy} onClick={check}>
            Zahlungsstatus erneut prüfen
          </button>
        )}
        {result?.status === "paid" && (
          <>
            <p>
              Buchungsnummer: <b>{result.booking_id}</b>
            </p>
            <div className="camp-actions">
              <Link
                className="primary-button"
                href={`/camp/buchung/${result.camp_id}`}
              >
                Weiteres Kind buchen
              </Link>
              <Link className="secondary-button" href="/camps">
                Zum Portal
              </Link>
              <button
                className="secondary-button"
                onClick={async () => {
                  try {
                    const r = await campApi("invitation-wish", {
                      id: result.booking_id,
                    });
                    setMessage(r.message);
                  } catch (e) {
                    setError((e as Error).message);
                  }
                }}
              >
                Portalzugang anfragen
              </button>
              <Link
                href={loginHref}
                className="text-button"
                onClick={() => sessionStorage.removeItem("camp_parent")}
              >
                Fertig
              </Link>
            </div>
          </>
        )}
        {message && (
          <p role="status" className="camp-success">
            {message}
          </p>
        )}
      </section>
    </CampFrame>
  );
}

"use client";
import { useRef, useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import { Brand } from "@/components/portal";
import { formatDate, formatTime } from "@/lib/domain";
import { TRIAL_CONTACT, type TrialCamp } from "@/lib/trials/domain";
export async function trialApi(action: string, body: unknown) {
  const response = await fetch(`/api/probetraining/${action}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const data = await response.json();
  if (!response.ok) throw new Error(data.error);
  return data;
}
export function TrialContact() {
  return (
    <div className="trial-contact">
      Fragen? Wir helfen dir persönlich.
      <br />
      <a href={`mailto:${TRIAL_CONTACT.email}`}>{TRIAL_CONTACT.email}</a>
      <br />
      <a href={`tel:${TRIAL_CONTACT.tel}`}>{TRIAL_CONTACT.phone}</a>
    </div>
  );
}
export function TrialCamps({ camps }: { camps: TrialCamp[] }) {
  return camps.length ? (
    <section>
      <h2>Als Nächstes: unsere Camps</h2>
      <div className="trial-grid">
        {camps.map((c) => (
          <a
            className="trial-camp-link"
            href={`/camp/buchung/${c.id}`}
            key={c.id}
          >
            <strong>{c.title}</strong>
            <p>
              {formatDate(c.starts_at)} · {c.location}
            </p>
            <span>Camp entdecken →</span>
          </a>
        ))}
      </div>
    </section>
  ) : null;
}
export function TrialApplication({ camps }: { camps: TrialCamp[] }) {
  const request = useRef(crypto.randomUUID());
  const [children, setChildren] = useState([0]);
  const nextChild = useRef(1);
  const [busy, setBusy] = useState(false),
    [error, setError] = useState(""),
    [sent, setSent] = useState(false);
  return (
    <main className="trial-page">
      <Brand />
      <span className="trial-tag">Dein erster Schritt zur ProAcademy</span>
      <h1>
        Erst kennenlernen.
        <br />
        Dann gemeinsam wachsen.
      </h1>
      <p className="trial-intro">
        Ein kostenloses Probetraining für dein Kind. Wir rufen dich an und
        finden gemeinsam einen passenden Termin. Ohne Abo und ohne
        Zahlungsdaten.
      </p>
      {sent ? (
        <section className="trial-card">
          <h2>Willkommen bei der ProAcademy!</h2>
          <p>
            Deine Anfrage ist angekommen. Bitte bestätige deine E-Mail über den
            persönlichen Link, den wir dir schicken. In deinem kleinen
            Willkommensportal findest du danach den Stand deiner Anfrage.
          </p>
          <TrialContact />
        </section>
      ) : (
        <form
          className="trial-card trial-form"
          onSubmit={async (e) => {
            e.preventDefault();
            setBusy(true);
            setError("");
            const f = new FormData(e.currentTarget);
            try {
              await trialApi("apply", {
                request_id: request.current,
                parent_name: f.get("parent_name"),
                email: f.get("email"),
                phone: f.get("phone"),
                children: children.map((id) => ({
                  first_name: f.get(`first-${id}`),
                  last_name: f.get(`last-${id}`),
                  birth_date: f.get(`birth-${id}`),
                  club: f.get(`club-${id}`),
                })),
                preferred_location: f.get("location"),
                availability: f.get("availability"),
                operational_consent: f.get("operational") === "on",
                privacy_acknowledged: f.get("privacy") === "on",
                marketing_consent: f.get("marketing") === "on",
                website: f.get("website"),
              });
              setSent(true);
            } catch (e) {
              setError((e as Error).message);
            } finally {
              setBusy(false);
            }
          }}
        >
          <h2>Probetraining anfragen</h2>
          <p className="trial-required">
            Mit * markierte Felder sind Pflichtfelder. Zusätzliche Angebotsmails
            sind freiwillig.
          </p>
          <p>
            Eine Anfrage pro Elternteil, für ein bis drei Kinder. Bereits bei
            uns bekannt? Bitte melde dich direkt beim Team.
          </p>
          <div className="form-grid">
            <label>
              Dein Vor- und Nachname *
              <input
                name="parent_name"
                required
                minLength={2}
                maxLength={120}
                autoComplete="name"
              />
            </label>
            <label>
              E-Mail *
              <input
                name="email"
                type="email"
                required
                maxLength={254}
                autoComplete="email"
              />
            </label>
            <label>
              Telefonnummer *
              <input
                name="phone"
                type="tel"
                required
                minLength={7}
                maxLength={40}
                autoComplete="tel"
              />
            </label>
          </div>
          {children.map((id, i) => (
            <fieldset key={id}>
              <legend>Kind {i + 1}</legend>
              <div className="form-grid">
                <label>
                  Vorname *
                  <input
                    name={`first-${id}`}
                    required
                    minLength={2}
                    maxLength={120}
                  />
                </label>
                <label>
                  Nachname *
                  <input
                    name={`last-${id}`}
                    required
                    minLength={2}
                    maxLength={120}
                  />
                </label>
                <label>
                  Geburtsdatum *
                  <input
                    name={`birth-${id}`}
                    type="date"
                    required
                    min="2000-01-01"
                    max={new Date().toISOString().slice(0, 10)}
                  />
                </label>
                <label>
                  Verein (optional)
                  <input name={`club-${id}`} maxLength={120} />
                </label>
              </div>
              {children.length > 1 && (
                <button
                  type="button"
                  className="text-button"
                  onClick={() => setChildren(children.filter((c) => c !== id))}
                >
                  Kind entfernen
                </button>
              )}
            </fieldset>
          ))}
          {children.length < 3 && (
            <button
              type="button"
              className="secondary-button"
              onClick={() => setChildren([...children, nextChild.current++])}
            >
              Weiteres Kind hinzufügen
            </button>
          )}
          <label>
            Gewünschter Standort (optional)
            <input
              name="location"
              placeholder="z. B. Gelsenkirchen"
              maxLength={120}
            />
          </label>
          <label>
            Wann passt es euch? (optional)
            <textarea
              name="availability"
              maxLength={500}
              placeholder="Mögliche Wochentage oder eine kurze Nachricht an das Team"
            />
          </label>
          <label className="trial-honey" aria-hidden="true">
            Website
            <input name="website" tabIndex={-1} autoComplete="off" />
          </label>
          <label className="checkbox-label">
            <input type="checkbox" name="operational" required />
            Ich möchte E-Mails zur Anfrage, Terminplanung, Erinnerung und zum
            Feedback meines Probetrainings erhalten. *
          </label>
          <label className="checkbox-label">
            <input type="checkbox" name="privacy" required />
            <span>
              Ich habe die{" "}
              <a
                href="https://proacademy-ak.com/datenschutz"
                target="_blank"
                rel="noreferrer"
              >
                Datenschutzhinweise
              </a>{" "}
              gelesen und bin berechtigt, die Angaben für diese Kinder zu
              übermitteln. *
            </span>
          </label>
          <label className="checkbox-label">
            <input type="checkbox" name="marketing" />
            Optional: Ich möchte nach dem Probetraining weitere Informationen zu
            Academy-Angeboten und Portalmöglichkeiten per E-Mail erhalten. Diese
            Zustimmung kann ich jederzeit im Willkommensportal widerrufen.
          </label>
          {error && (
            <p role="alert" className="error-message">
              {error}
            </p>
          )}
          <button className="primary-button" disabled={busy}>
            {busy ? "Wird übermittelt …" : "Kostenloses Probetraining anfragen"}
          </button>
          <TrialContact />
        </form>
      )}
      <TrialCamps camps={camps} />
    </main>
  );
}
export function TrialAccess({ token }: { token: string }) {
  const router = useRouter();
  const [error, setError] = useState(""),
    [busy, setBusy] = useState(false);
  return (
    <main className="trial-page">
      <Brand />
      <section className="trial-card">
        <h1>Dein persönliches Willkommen.</h1>
        <p>
          Bestätige deine E-Mail, um deine Anfrage und deinen Termin anzusehen.
        </p>
        <button
          className="primary-button"
          disabled={busy}
          onClick={async () => {
            setBusy(true);
            try {
              await trialApi("access", { token });
              router.replace("/probetraining/willkommen");
              router.refresh();
            } catch (e) {
              setError((e as Error).message);
              setBusy(false);
            }
          }}
        >
          {busy ? "Wird geöffnet …" : "E-Mail bestätigen & Portal öffnen"}
        </button>
        {error && <p role="alert">{error}</p>}
        <TrialContact />
      </section>
    </main>
  );
}
export interface WelcomeRow {
  id: string;
  event_id: string | null;
  first_name: string;
  last_name: string;
  status: string;
  confirmed_at: string | null;
  starts_at: string | null;
  ends_at: string | null;
  event_title: string | null;
  event_status: string | null;
  attendance: string | null;
  location_name: string | null;
  address: string | null;
  coach_name: string | null;
  academy_feedback: string | null;
  academy_rating: number | null;
  parent_rating: number | null;
  subscribed: boolean;
}
export function TrialWelcome({
  family,
  rows,
  camps,
}: {
  family: { name: string; marketing_consent: boolean };
  rows: WelcomeRow[];
  camps: TrialCamp[];
}) {
  const router = useRouter();
  const [error, setError] = useState(""),
    [busy, setBusy] = useState(false);
  return (
    <main className="trial-page">
      <Brand />
      <h1>Willkommen, {family.name}.</h1>
      <p className="trial-intro">
        Hier findet ihr eure Termine und das persönliche Feedback zum
        Probetraining. Wenn noch kein Termin feststeht, stimmen wir ihn
        telefonisch mit euch ab.
      </p>
      <div className="trial-grid">
        {rows.map((r) => (
          <section className="trial-card" key={r.id}>
            <h2>
              {r.first_name} {r.last_name}
            </h2>
            <span className="trial-tag">
              {r.status === "closed"
                ? "Anfrage abgeschlossen"
                : r.confirmed_at
                  ? "Teilnahme bestätigt"
                  : r.event_status === "cancelled" ||
                      ["excused", "cancelled", "absent"].includes(
                        r.attendance ?? "",
                      )
                    ? "Bitte neuen Termin abstimmen"
                    : r.starts_at
                      ? "Probetraining geplant"
                      : "Termin wird abgestimmt"}
            </span>
            {r.starts_at && (
              <>
                <p>
                  <strong>
                    {formatDate(r.starts_at)} · {formatTime(r.starts_at)}–
                    {formatTime(r.ends_at!)} Uhr
                  </strong>
                  <br />
                  {r.location_name}
                  <br />
                  {r.address}
                  <br />
                  Coach: {r.coach_name}
                </p>
                {!r.confirmed_at &&
                  r.event_status === "scheduled" &&
                  r.attendance === "planned" && (
                    <p>
                      Bitte Sportsachen, passende Schuhe und etwas zu trinken
                      mitbringen.
                    </p>
                  )}
              </>
            )}
            {r.academy_feedback && (
              <div>
                <h3>Dein Feedback vom Coach</h3>
                <p>{r.academy_rating} von 5</p>
                <p className="trial-feedback">{r.academy_feedback}</p>
              </div>
            )}
            {r.confirmed_at &&
              (r.parent_rating ? (
                <p>Danke für eure Bewertung: {r.parent_rating} von 5.</p>
              ) : (
                <TrialParentRating row={r} />
              ))}
            {!r.subscribed && r.confirmed_at && (
              <a className="primary-button" href="https://proacademy-ak.com">
                Academy-Angebote entdecken →
              </a>
            )}
          </section>
        ))}
      </div>
      <TrialContact />
      <TrialCamps camps={camps} />
      {family.marketing_consent && (
        <button
          className="text-button"
          disabled={busy}
          onClick={async () => {
            setBusy(true);
            try {
              await trialApi("unsubscribe", {});
              router.refresh();
            } catch (e) {
              setError((e as Error).message);
            } finally {
              setBusy(false);
            }
          }}
        >
          Weitere Angebotsmails abbestellen
        </button>
      )}
      {error && <p role="alert">{error}</p>}
    </main>
  );
}
function TrialParentRating({ row }: { row: WelcomeRow }) {
  const router = useRouter();
  const [score, setScore] = useState(0),
    [feedback, setFeedback] = useState(""),
    [busy, setBusy] = useState(false),
    [done, setDone] = useState(false),
    [error, setError] = useState("");
  async function send(rating: number) {
    setBusy(true);
    setError("");
    try {
      await trialApi("feedback", {
        action: "feedback",
        request_id: row.id,
        event_id: row.event_id,
        rating,
        feedback,
      });
      router.push("/probetraining/danke");
      setScore(rating);
      setDone(true);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <div>
      <h3>Wie hat es euch gefallen?</h3>
      {done ? (
        <p>Danke! Eure Bewertung {score}/5 wurde gespeichert.</p>
      ) : (
        <>
          <label>
            Was möchtet ihr uns mitgeben? (optional)
            <textarea
              value={feedback}
              onChange={(e) => setFeedback(e.target.value)}
              maxLength={2000}
            />
          </label>
          <p>
            Ein Klick auf die Bewertung speichert euer Feedback. 1 = nicht
            zufrieden, 5 = sehr zufrieden.
          </p>
          <div className="trial-rating">
            {[1, 2, 3, 4, 5].map((n) => (
              <button
                key={n}
                className="secondary-button"
                disabled={busy}
                onClick={() => send(n)}
                aria-label={`${n} von 5 für ${row.first_name}`}
              >
                {n} ★
              </button>
            ))}
          </div>
        </>
      )}
      {error && <p role="alert">{error}</p>}
    </div>
  );
}

export function TrialEmailRating({
  token,
  request,
  event,
  rating,
}: {
  token: string;
  request: string;
  event: string;
  rating: number;
}) {
  const router = useRouter();
  const started = useRef(false);
  const [error, setError] = useState("");
  useEffect(() => {
    const save = () => {
      if (started.current || document.visibilityState !== "visible") return;
      started.current = true;
      void (async () => {
        try {
          await trialApi("access", { token });
          await trialApi("feedback", {
            action: "feedback",
            request_id: request,
            event_id: event,
            rating,
            feedback: "",
          });
          router.replace("/probetraining/danke");
        } catch (e) {
          setError((e as Error).message);
        }
      })();
    };
    save();
    document.addEventListener("visibilitychange", save);
    return () => document.removeEventListener("visibilitychange", save);
  }, [token, request, event, rating, router]);
  return (
    <main className="trial-page">
      <Brand />
      <h1>
        {error
          ? "Bewertung noch nicht gespeichert"
          : "Deine Bewertung wird gespeichert …"}
      </h1>
      {error ? (
        <p role="alert">{error}</p>
      ) : (
        <p>Du musst nichts weiter bestätigen.</p>
      )}
      <TrialContact />
    </main>
  );
}

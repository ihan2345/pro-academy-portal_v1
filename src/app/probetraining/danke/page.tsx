import Link from "next/link";
import { notFound } from "next/navigation";
import {
  trialFeatureEnabled,
  trialRatingGrant,
  trialSavedFeedback,
} from "@/lib/trials/server";
import { TrialContact, TrialParentRating } from "@/components/trials/public";
import "@/components/trials/trials.css";
export const dynamic = "force-dynamic";
export const metadata = {
  robots: { index: false, follow: false },
  referrer: "no-referrer",
};
export default async function Page({
  searchParams,
}: {
  searchParams: Promise<{ ratingToken?: string }>;
}) {
  if (!trialFeatureEnabled()) notFound();
  const { ratingToken } = await searchParams;
  let saved = null;
  if (ratingToken) {
    try {
      const grant = await trialRatingGrant(ratingToken);
      saved = await trialSavedFeedback(
        grant.family,
        grant.request!,
        grant.event!,
      );
    } catch {
      /* Never claim an invalid link was saved. */
    }
  }
  return (
    <main className="trial-page">
      <span className="trial-tag">PROACADEMY · GEMEINSAM WACHSEN</span>
      <h1>Danke für euer Feedback.</h1>
      <p className="trial-intro">
        {saved
          ? "Eure Sterne sind gespeichert. Eine persönliche Nachricht ist freiwillig."
          : "Euer Blick hilft uns, die Academy weiterzuentwickeln."}
      </p>
      {saved && (
        <section className="trial-card">
          <h2>Rückmeldung für {saved.first_name}</h2>
          <TrialParentRating row={saved} token={ratingToken} />
        </section>
      )}
      <section className="trial-card">
        <h2>Jedes Kind zählt.</h2>
        <p>
          Freude am Fußball, Respekt und persönliche Entwicklung stehen bei uns
          im Mittelpunkt. Wir möchten Kindern Raum geben, Neues auszuprobieren,
          Fehler zu machen und mit Selbstvertrauen weiterzulernen.
        </p>
        <h2>Euer Blick hilft uns.</h2>
        <p>
          Wie hat sich euer Kind gefühlt? Was hat gut funktioniert, was können
          wir verbessern? Eure Rückmeldung hilft dem Academy-Team, die Betreuung
          und das Training weiterzuentwickeln.
        </p>
        <h2>So kann es weitergehen</h2>
        <p>
          Das persönliche Coachfeedback bleibt in eurem Willkommensportal
          verfügbar. Wenn ihr weitertrainieren möchtet, besprechen wir gemeinsam
          passende Trainingszeiten und ein Angebot für euer Kind. Eure bereits
          hinterlegten Angaben bleiben erhalten.
        </p>
        <Link className="primary-button" href="/probetraining/willkommen">
          Zum Willkommensportal
        </Link>
      </section>
      <TrialContact />
    </main>
  );
}

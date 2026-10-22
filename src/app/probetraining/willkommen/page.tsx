import Link from "next/link";
import { Portal } from "@/components/portal";
import { loadPortal } from "@/lib/server/data";
import { notFound, redirect } from "next/navigation";
import {
  TrialAccess,
  TrialEmailRating,
  TrialContact,
  TrialResendAccess,
  TrialWelcome,
} from "@/components/trials/public";
import {
  trialFeatureEnabled,
  trialCamps,
  trialWelcomeData,
} from "@/lib/trials/server";
import { HttpError } from "@/lib/server/security";
import "@/components/trials/trials.css";
export const dynamic = "force-dynamic";
export const metadata = {
  robots: { index: false, follow: false },
  referrer: "no-referrer",
};
export default async function Page({
  searchParams,
}: {
  searchParams: Promise<{
    token?: string;
    ratingToken?: string;
  }>;
}) {
  if (!(await trialFeatureEnabled())) notFound();
  const { token, ratingToken } = await searchParams;
  if (ratingToken) return <TrialEmailRating token={ratingToken} />;
  if (token) return <TrialAccess token={token} />;
  try {
    const data = await trialWelcomeData();
    if (!data.rows.length) redirect("/profil");
    return (
      <Portal
        initial={await loadPortal("konto")}
        section="probetraining/willkommen"
      >
        <TrialWelcome {...data} camps={await trialCamps()} />
      </Portal>
    );
  } catch (e) {
    if (!(e instanceof HttpError)) throw e;
    return (
      <main className="trial-page">
        <h1>Dein Willkommensportal</h1>
        <p>{e.message}</p>
        <p>
          <Link href="/camps">Zu Camps und bisherigen Buchungen</Link> ·{" "}
          <Link href="/profil">Zum Elternprofil</Link>
        </p>
        <TrialResendAccess />
        <TrialContact />
      </main>
    );
  }
}

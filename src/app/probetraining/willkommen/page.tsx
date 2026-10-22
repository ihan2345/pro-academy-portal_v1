import { notFound } from "next/navigation";
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
  if (!trialFeatureEnabled()) notFound();
  const { token, ratingToken } = await searchParams;
  if (ratingToken) return <TrialEmailRating token={ratingToken} />;
  if (token) return <TrialAccess token={token} />;
  try {
    const data = await trialWelcomeData();
    return <TrialWelcome {...data} camps={await trialCamps()} />;
  } catch (e) {
    if (!(e instanceof HttpError)) throw e;
    return (
      <main className="trial-page">
        <h1>Dein Willkommensportal</h1>
        <p>{e.message}</p>
        <TrialResendAccess />
        <TrialContact />
      </main>
    );
  }
}

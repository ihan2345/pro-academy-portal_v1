import { notFound } from "next/navigation";
import {
  TrialAccess,
  TrialEmailRating,
  TrialContact,
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
    request?: string;
    event?: string;
    rating?: string;
  }>;
}) {
  if (!trialFeatureEnabled()) notFound();
  const { token, request, event, rating } = await searchParams;
  if (token && request && event && /^[1-5]$/.test(rating ?? ""))
    return (
      <TrialEmailRating
        token={token}
        request={request}
        event={event}
        rating={Number(rating)}
      />
    );
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
        <TrialContact />
      </main>
    );
  }
}

import { notFound } from "next/navigation";
import {
  TrialAccess,
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
  searchParams: Promise<{ token?: string }>;
}) {
  if (!trialFeatureEnabled()) notFound();
  const { token } = await searchParams;
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

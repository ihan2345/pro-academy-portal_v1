import { notFound } from "next/navigation";
import { TrialApplication } from "@/components/trials/public";
import { trialFeatureEnabled, trialCamps } from "@/lib/trials/server";
import "@/components/trials/trials.css";
export const dynamic = "force-dynamic";
export default async function Page() {
  if (!(await trialFeatureEnabled())) notFound();
  return <TrialApplication camps={await trialCamps()} />;
}

import { redirect } from "next/navigation";
import { legalDestinations } from "@/lib/site/company";
export default function AgbPage() {
  redirect(legalDestinations.terms);
}

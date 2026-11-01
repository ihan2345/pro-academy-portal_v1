import { redirect } from "next/navigation";
import { legalDestinations } from "@/lib/site/company";
export default function DatenschutzPage() {
  redirect(legalDestinations.privacy);
}

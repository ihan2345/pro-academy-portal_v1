import { LocalCampLogin } from "@/components/camps/local-login";
import { requireCampLocal } from "@/lib/camps/guard";
import { notFound } from "next/navigation";
export default async function Page() {
  try {
    await requireCampLocal();
  } catch {
    notFound();
  }
  const emails = [
    process.env.EMAIL_TEST_RECIPIENT ?? "",
    ...(process.env.AUTH_TEST_EMAILS ?? "").split(","),
  ]
    .map((e) => e.trim())
    .filter(Boolean);
  return <LocalCampLogin emails={[...new Set(emails)]} />;
}

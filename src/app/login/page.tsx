import { LoginForm } from "@/components/login";
import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { canonicalLocalLogin } from "@/lib/server/local-login";
export default async function Login({
  searchParams,
}: {
  searchParams: Promise<{ error?: string }>;
}) {
  const { error } = await searchParams;
  const initialError =
    error === "auth"
      ? "Der Anmeldelink ist abgelaufen, wurde bereits verwendet oder gehört zu einem anderen Browser. Bitte fordere hier einen neuen Link an."
      : error === "invitation"
        ? "Deine Einladung konnte nicht bestätigt werden. Bitte wende dich an unser Team."
        : "";
  const target = canonicalLocalLogin((await headers()).get("host"));
  if (target) redirect(initialError ? `${target}?error=${error}` : target);
  return <LoginForm initialError={initialError} />;
}

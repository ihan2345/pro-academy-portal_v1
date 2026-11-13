import { LoginForm } from "@/components/login";
import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { canonicalLocalLogin } from "@/lib/server/local-login";
export default async function Login({
  searchParams,
}: {
  searchParams: Promise<{ error?: string; player?: string; shop?: string }>;
}) {
  const { error, player, shop } = await searchParams;
  const playerId =
    player &&
    /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(
      player,
    )
      ? player
      : undefined;
  const initialError =
    error === "auth"
      ? "Der Anmeldelink ist abgelaufen, wurde bereits verwendet oder gehört zu einem anderen Browser. Bitte fordere hier einen neuen Code mit Anmeldelink an."
      : error === "account"
        ? "Deine E-Mail ist bestätigt. Die Familienzuordnung benötigt eine Prüfung durch unser Team. Bitte nicht erneut als Gast buchen."
        : error === "invitation"
          ? "Deine Einladung konnte nicht bestätigt werden. Bitte wende dich an unser Team."
          : "";
  const target = canonicalLocalLogin((await headers()).get("host"));
  if (target) {
    const login = new URL(target);
    if (initialError && error) login.searchParams.set("error", error);
    if (playerId) login.searchParams.set("player", playerId);
    redirect(login.href);
  }
  return (
    <LoginForm
      initialError={initialError}
      playerId={playerId}
      returnToShop={shop === "1"}
    />
  );
}

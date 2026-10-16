import { PlayerProfilePage } from "@/components/player-profile-page";
export const dynamic = "force-dynamic";
export default function Page(props: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ edit?: string }>;
}) {
  return <PlayerProfilePage {...props} area="team" />;
}

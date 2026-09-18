import { campPageGuard } from "@/lib/camps/guard";
import "@/components/camps/camps.css";
import { CampLoginProvider } from "@/components/camps/shared";
import { campLoginHref } from "@/lib/camps/runtime";
export const dynamic = "force-dynamic";
export default async function Layout({
  children,
}: {
  children: React.ReactNode;
}) {
  await campPageGuard();
  return (
    <CampLoginProvider value={campLoginHref()}>{children}</CampLoginProvider>
  );
}

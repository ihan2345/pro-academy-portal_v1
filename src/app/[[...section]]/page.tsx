import { notFound } from "next/navigation";
import { loadPortal } from "@/lib/server/data";
import { Portal } from "@/components/portal";
export const dynamic = "force-dynamic";
const routes = [
  "",
  "termine",
  "stempelkarte",
  "berichte",
  "konto",
  "team",
  "admin",
  "admin/trainingsplanung",
  "admin/spieler",
  "admin/eltern",
  "admin/mitarbeiter",
  "admin/standorte",
  "admin/produkte",
  "admin/stripe",
  "admin/einladungen",
  "admin/protokolle",
  "admin/einstellungen",
];
export default async function Page({
  params,
}: {
  params: Promise<{ section?: string[] }>;
}) {
  const section = (await params).section?.join("/") ?? "";
  if (!routes.includes(section)) notFound();
  return <Portal initial={await loadPortal(section)} section={section} />;
}

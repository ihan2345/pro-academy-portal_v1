import { redirect, notFound } from "next/navigation";
import Link from "next/link";
import { profileSession, profileShell } from "@/lib/server/parent-profile";
import { loadPlayerExport } from "@/lib/server/player-export";
import { HttpError } from "@/lib/server/security";
import { Portal } from "@/components/portal";
import { formatDate } from "@/lib/domain";
export const dynamic = "force-dynamic";
export default async function PlayerCard({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  if (!/^[0-9a-f-]{36}$/i.test(id)) notFound();
  let session;
  try {
    session = await profileSession();
  } catch (error) {
    if (error instanceof HttpError && error.status === 401)
      redirect(`/login?player=${id}`);
    throw error;
  }
  if (session.role !== "admin") notFound();
  const player = (await loadPlayerExport(id)).find((p) => p.id === id);
  if (!player) notFound();
  const fields = [
    ["Elternteil", player.elternteile.join(", ")],
    ["Geburtsjahr", player.geburtsjahr],
    ["Geschlecht", player.geschlecht],
    ["Verein", player.verein],
    ["Position", player.position],
    ["Starker Fuß", player.fuss],
    ["Größe", player.groesse_cm ? `${player.groesse_cm} cm` : null],
    ["Aktive Monate insgesamt", player.aktive_monate],
  ];
  return (
    <Portal initial={profileShell(session)} section="admin/spieler">
      <section className="panel account-panel">
        <Link href="/admin/spieler">← Spieler verwalten</Link>
        <h1>{player.spielername}</h1>
        <p>Spielerkarte{player.archiviert ? " · Archiviert" : ""}</p>
        {fields.map(([label, value]) => (
          <div className="account-row" key={label}>
            <span>{label}</span>
            <strong>{value ?? "Nicht hinterlegt"}</strong>
          </div>
        ))}
        <h2>Entwicklungsziele</h2>
        <p style={{ whiteSpace: "pre-wrap" }}>
          {player.entwicklungsziele || "Noch keine Ziele hinterlegt."}
        </p>
        <h2>Aktuelle Abos</h2>
        {player.abos.length ? (
          player.abos.map((abo, i) => (
            <div key={i} className="account-row">
              <strong>{abo.art}</strong>
              <span>
                {formatDate(abo.von)} – {formatDate(abo.bis)}
              </span>
            </div>
          ))
        ) : (
          <p>Kein aktueller Abo-Zeitraum.</p>
        )}
      </section>
    </Portal>
  );
}

import { redirect, notFound } from "next/navigation";
import Link from "next/link";
import { profileSession, profileShell } from "@/lib/server/parent-profile";
import { loadPlayerExport } from "@/lib/server/player-export";
import { HttpError } from "@/lib/server/security";
import { Portal } from "@/components/portal";
import { PlayerProfileEditor } from "@/components/player-profile-editor";
import { formatDate } from "@/lib/domain";
import { DESIGN_2026 } from "@/design-2026/flag";
import { PlayerCard } from "@/design-2026/player-card";
import { maskForViewer } from "@/lib/server/viewer";
import { StampCardInline } from "@/design-2026/stamp-card-inline";
export async function PlayerProfilePage({
  area,
  params,
  searchParams,
}: {
  area: "admin" | "team";
  params: Promise<{ id: string }>;
  searchParams: Promise<{ edit?: string }>;
}) {
  const { id } = await params;
  const edit = (await searchParams).edit === "1";
  if (!/^[0-9a-f-]{36}$/i.test(id)) notFound();
  let session;
  try {
    session = await profileSession();
  } catch (error) {
    if (error instanceof HttpError && error.status === 401)
      redirect(`/login?player=${id}`);
    throw error;
  }
  if (session.role !== (area === "admin" ? "admin" : "staff")) notFound();
  const player = await maskForViewer(
    session.viewer,
    (await loadPlayerExport(id)).find((p) => p.id === id),
  );
  if (!player) notFound();
  const editable = await session.db
    .from("players")
    .select(
      "id,first_name,last_name,birth_year,team,gender,club,position,strong_foot,height_cm,development_goals",
    )
    .eq("id", id)
    .maybeSingle();
  if (editable.error)
    throw new HttpError(503, "Kinderdaten konnten nicht geladen werden.");
  if (!editable.data) notFound();
  editable.data = await maskForViewer(session.viewer, editable.data);
  // Lese-Konten sehen keinen Bearbeiten-Bereich.
  const canEdit = session.role === "admin" && !session.viewer;
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
  // Stempelkarte direkt im Spielerprofil (archivierte Kinder haben keine).
  const stamp = player.archiviert ? null : (
    <StampCardInline
      kids={[{ id, name: player.spielername }]}
      fullHref={`/${area}/stempelkarten`}
    />
  );
  if (DESIGN_2026)
    return (
      <Portal
        initial={profileShell(session)}
        section={`${area}/spielerprofile`}
      >
        <PlayerCard
          player={player}
          team={editable.data.team}
          back={`/${area}/spielerprofile`}
          stamp={stamp}
          editor={
            canEdit ? (
              <PlayerProfileEditor
                key={`${id}:${edit}`}
                player={editable.data}
                initiallyOpen={edit}
              />
            ) : undefined
          }
        />
      </Portal>
    );
  return (
    <Portal initial={profileShell(session)} section={`${area}/spielerprofile`}>
      <section className="panel account-panel">
        <Link href={`/${area}/spielerprofile`}>← Spielerprofile</Link>
        <h1>{player.spielername}</h1>
        <p>Spielerkarte{player.archiviert ? " · Archiviert" : ""}</p>
        {canEdit && (
          <PlayerProfileEditor
            key={`${id}:${edit}`}
            player={editable.data}
            initiallyOpen={edit}
          />
        )}
        {fields.map(([label, value]) => (
          <div className="account-row" key={label}>
            <span>{label}</span>
            <strong>{value ?? "Nicht hinterlegt"}</strong>
          </div>
        ))}
        {stamp}
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

// Text der Einladungswelle (Release 062). Bleibt ohne Server-Abhängigkeiten,
// damit Mail-Worker, Vorschau und Tests denselben Text nutzen.
export function invitationWaveText(payload: {
  parent_name?: string;
  expires_at?: string;
}) {
  const until = payload.expires_at
    ? new Date(payload.expires_at).toLocaleDateString("de-DE", {
        day: "2-digit",
        month: "2-digit",
        year: "numeric",
        timeZone: "Europe/Berlin",
      })
    : "";
  return [
    `Hallo ${payload.parent_name ?? ""},`,
    "ab sofort ist dein persönliches ProAcademy-Elternportal für dich freigeschaltet. Dort findest du alles zum Training deines Kindes an einem Ort: Termine und Teilnahmen, Trainingsberichte, die Stempelkarte und deine Camp-Buchungen.",
    "So geht's: Tippe auf „Einladung annehmen“ und melde dich mit dieser E-Mail-Adresse an. Du bekommst dafür einen Anmeldecode per E-Mail.",
    until
      ? `Deine Einladung ist bis ${until} gültig. Danach kannst du dich jederzeit direkt unter portal.proacademy-ak.com mit dieser E-Mail-Adresse anmelden.`
      : "Danach kannst du dich jederzeit direkt unter portal.proacademy-ak.com mit dieser E-Mail-Adresse anmelden.",
    "Wir freuen uns auf dich!",
  ].join("\n");
}

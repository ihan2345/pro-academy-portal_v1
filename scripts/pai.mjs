// Privileged operator command; changes the same database switch as the admin UI.
import { spawnSync } from "node:child_process";
const values = {
  aktiv: "true",
  aktivieren: "true",
  deaktiv: "false",
  deaktivieren: "false",
};
const value = values[process.argv[2]];
if (!value || process.argv.length !== 3) {
  console.error("Aufruf: npm run pai -- aktivieren | deaktivieren");
  process.exit(1);
}
// SQL contains only the validated boolean above. Supabase CLI supplies operator auth.
const sql = `begin;
select pg_advisory_xact_lock(170001);
select set_config('app.audit_reason','pAi Verwaltungsbefehl',true);
do $$ begin
 update public.platform_features set enabled=${value},updated_by=null,updated_at=clock_timestamp() where key='pai';
 if not found then raise exception 'pAi-Schalter fehlt'; end if;
end $$;
commit;`;
const result = spawnSync(
  "npx",
  [
    "supabase",
    "db",
    "query",
    "--linked",
    "--project-ref",
    "vgxaatawsbzgsmqiaepj",
    sql,
  ],
  { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] },
);
if (result.error) {
  console.error(result.error.message);
  process.exit(1);
}
if (result.status !== 0) {
  console.error(
    "Schalter nicht geändert. Supabase-CLI-Anmeldung und Projektzugriff prüfen.",
  );
  process.exit(result.status ?? 1);
}
console.log(
  value === "true"
    ? "pAi aktiviert: direkter Link /pai, bestehende Rollenrechte gelten."
    : "pAi deaktiviert: Seiten und sämtliche pAi-APIs gesperrt.",
);

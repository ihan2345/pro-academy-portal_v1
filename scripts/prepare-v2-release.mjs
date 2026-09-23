// Generates reviewable SQL only. Does not connect, migrate, deploy or send mail.
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { resolve } from "node:path";

const destination = resolve("output/v2-release");
mkdirSync(destination, { recursive: true });
const files = [
  "supabase/migrations/202609230010_training_backfills.sql",
  "supabase/migrations/202609230011_stripe_customer_registry.sql",
  "supabase/release/002-v2-backfill-mail.sql",
  "supabase/release/003-v2-stage-lock.sql",
];
const contents = files.map((path) => ({
  path,
  sql: readFileSync(path, "utf8"),
}));
const history = contents
  .filter(({ path }) => path.startsWith("supabase/migrations/"))
  .map(({ path, sql }) => {
    const [, version, name] = path.match(/\/(\d+)_(.+)\.sql$/);
    if (sql.includes("$v2_history$"))
      throw new Error("SQL quote delimiter collision");
    return `insert into supabase_migrations.schema_migrations(version,name,statements) values('${version}','${name}',array[$v2_history$${sql}$v2_history$]);`;
  })
  .join("\n");
const preflight = `begin transaction read only;
select jsonb_build_object(
 'checked_at',now(),
 'functions',(select jsonb_agg(jsonb_build_object('signature',p.oid::regprocedure::text,'definition',pg_get_functiondef(p.oid),'grants',p.proacl::text))
   from pg_proc p join pg_namespace n on n.oid=p.pronamespace
   where n.nspname='public' and p.proname in ('capture_report','register_report_file','parent_delivery_allowed','claim_notifications','hold_family_notification')),
 'settings',(select jsonb_object_agg(key,value) from public.system_settings where key in ('portal_delivery_release','camp_mail_release')),
 'v2_tables',jsonb_build_object('backfills',to_regclass('public.training_backfills'),'private_notes',to_regclass('public.training_backfill_private_notes'),'registry',to_regclass('public.stripe_customer_registry')),
 'counts',jsonb_build_object('players',(select count(*) from public.players),'parents',(select count(*) from public.parents),'periods',(select count(*) from public.entitlement_periods),'reports',(select count(*) from public.report_snapshots),'report_files',(select count(*) from public.report_files)),
 'notification_statuses',(select jsonb_object_agg(status,n) from (select status,count(*) n from public.notification_jobs group by status) counts),
 'migration_history',to_regclass('supabase_migrations.schema_migrations')
) as preflight;
commit;
`;
writeFileSync(`${destination}/preflight.sql`, preflight, { mode: 0o600 });
writeFileSync(
  `${destination}/stage.sql`,
  "-- Target: vgxaatawsbzgsmqiaepj. Review live preflight definitions before execution.\n" +
    "begin;\nset local lock_timeout='5s';\nset local statement_timeout='60s';\n" +
    contents.map(({ path, sql }) => `\n-- ${path}\n${sql}`).join("\n") +
    `\n-- Register only the two migrations applied by this transaction.\n${history}\n` +
    "\nnotify pgrst, 'reload schema';\ncommit;\n",
  { mode: 0o600 },
);
writeFileSync(
  `${destination}/manifest.json`,
  JSON.stringify(
    {
      project_ref: "vgxaatawsbzgsmqiaepj",
      generated_at: new Date().toISOString(),
      state: "prepared_not_applied",
      files: contents.map(({ path, sql }) => ({
        path,
        sha256: createHash("sha256").update(sql).digest("hex"),
      })),
    },
    null,
    2,
  ) + "\n",
  { mode: 0o600 },
);
console.log(`Prepared SQL and manifest in ${destination}. No remote changes.`);

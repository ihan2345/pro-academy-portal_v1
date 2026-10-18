// Changes only the global runtime switch; preserves data, credentials and quotas.
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
const result = spawnSync(
  "npx",
  ["wrangler", "secret", "put", "PAI_ENABLED", "--env", "production"],
  {
    input: value + "\n",
    encoding: "utf8",
    stdio: ["pipe", "inherit", "inherit"],
  },
);
if (result.error) {
  console.error(result.error.message);
  process.exit(1);
}
if (result.status !== 0) process.exit(result.status ?? 1);
console.log(
  value === "true"
    ? "pAi aktiviert: direkter Link /pai, bestehende Rollenrechte gelten."
    : "pAi deaktiviert: Seiten und sämtliche pAi-APIs gesperrt.",
);

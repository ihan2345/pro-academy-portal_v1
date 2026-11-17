# Automatisches Deployment über GitHub Actions

Workflow: [`.github/workflows/deploy-production.yml`](../.github/workflows/deploy-production.yml)

## Was passiert

| Ereignis                            | Ablauf                                                                                                                            |
| ----------------------------------- | --------------------------------------------------------------------------------------------------------------------------------- |
| Pull Request gegen `main`           | `npm run typecheck` und `npm test`. Kein Deployment.                                                                              |
| Merge/Push in `main`                | Direkt `npm run build:cloudflare -- --env production` und `wrangler deploy --env production` → `https://portal.proacademy-ak.com` |
| Manuell („Run workflow“ auf `main`) | Prüfungen, danach Build und Deploy, z. B. für ein erneutes Deployment ohne Codeänderung.                                          |

Typecheck und Tests laufen in jedem Pull Request; ein PR mit rotem Test sollte nicht gemergt werden. Nach dem Merge in `main` laufen sie nicht noch einmal, damit der Deploy schneller ist (etwa 1,5 statt 3,5 Minuten). Beim manuellen Start („Run workflow“) laufen sie vor dem Deploy, und ein roter Test verhindert ihn. Deploys laufen nacheinander, nie parallel.

Nicht Teil dieses Workflows: der Hintergrunddienst `proacademy-jobs` (`workers/cloudflare/wrangler.jsonc`), Supabase-Migrationen und Cloudflare-Server-Secrets. Diese werden weiterhin separat und bewusst ausgeführt.

## Einmalige Einrichtung

### 1. Cloudflare API-Token erstellen

1. <https://dash.cloudflare.com/profile/api-tokens> öffnen → **Create Token**.
2. Vorlage **Edit Cloudflare Workers** → **Use template**.
3. **Account Resources:** Include → das ProAcademy-Konto.
4. **Zone Resources:** Include → Specific zone → `proacademy-ak.com` (nötig für die Custom Domain `portal.proacademy-ak.com`).
5. **Continue to summary** → **Create Token** → Token kopieren (wird nur einmal angezeigt).

Die Account-ID steht bereits in `wrangler.jsonc` und muss nicht als Secret hinterlegt werden.

### 2. Secrets in GitHub hinterlegen

Repository → **Settings** → **Secrets and variables** → **Actions** → **New repository secret**:

| Name                            | Wert                                                                              |
| ------------------------------- | --------------------------------------------------------------------------------- |
| `CLOUDFLARE_API_TOKEN`          | Token aus Schritt 1                                                               |
| `NEXT_PUBLIC_SUPABASE_URL`      | Supabase **Produktionsprojekt** → Project Settings → API → Project URL            |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | Supabase **Produktionsprojekt** → Project Settings → API → anon / publishable key |

Wichtig: Die beiden Supabase-Werte werden beim Build fest in das Portal eingebaut. Es müssen die Werte des **Produktions**projekts sein, dieselben wie bei bisherigen manuellen Produktions-Builds, nicht die Testwerte aus `.env.local`. Niemals den Service Role Key verwenden.

### 3. Prüfen

Repository → **Actions** → **Deploy Production** → **Run workflow** (Branch `main`). Nach grünem Lauf `https://portal.proacademy-ak.com` öffnen und Anmeldung prüfen.

Optional: Unter Settings → Environments → `production` können „Required reviewers“ gesetzt werden. Dann wartet jedes Deployment auf eine Freigabe per Klick.

## Arbeitsweise mit mehreren KI-Werkzeugen

- Branches mit Präfix: `claude/…` für Claude, `codex/…` für Codex.
- Jede Änderung als eigener Pull Request; `main` ist die einzige Wahrheit.
- Nicht zwei Werkzeuge gleichzeitig an denselben Dateien arbeiten lassen.
- Kein manuelles `wrangler deploy` des Portals mehr. Veröffentlicht wird ausschließlich durch einen Merge in `main`.

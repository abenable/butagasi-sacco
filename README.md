# Butagasi Sacco

Web application for the **Butagasi Sacco Management System**: members, savings, shares, loans, guarantors, accounting and multi-branch operations for Butagasi Sacco, Uganda.

It is a customised fork of the [Mifos® X Web App](https://github.com/openMF/web-app) running on an [Apache Fineract®](https://fineract.apache.org/) backend.

- **Live:** https://sacco.byte10x.dev
- **Currency:** UGX (Uganda Shillings)
- **Requirements:** see `Butagasi-Sacco-SRS.docx` (kept outside this repo)

## Customisations in this fork

| Area | Change |
|---|---|
| Branding | The product name "Mifos X / Mifos WebApp" is now **Butagasi Sacco** everywhere users see it: login, sidebar, footer, browser tab, setup wizard, help text, all 14 translations, `manifest.json`. Images are unchanged. |
| Currency | Both dashboards format money as **UGX** instead of `$`. |
| Dummy data removed | The global dashboard and the Institutional Operations dashboard no longer invent numbers (`Math.random`, hardcoded seeds, synthesized trends) when Fineract returns nothing. Empty data now shows as empty. The loan portfolio distribution and georeference map widgets were removed because they had no real data source. |
| Deployment | `docker-compose.yml` is set up for Coolify and connects to the Butagasi Fineract backend (see below). |

The Mifos licence headers and attribution (About page, "Mifos Initiative") are kept as the MPL-2.0 licence requires.

## Architecture

```
Browser ──► Caddy (https://sacco.byte10x.dev)
              ├── /fineract-provider/*  ──► Fineract API   127.0.0.1:18080   (~/fineract on the server)
              └── everything else       ──► this web app   127.0.0.1:14200   (Coolify)
                                             Fineract ──► PostgreSQL 17
```

- The browser calls the API on the **same origin**, so no CORS setup or Docker networking between the two stacks is needed.
- Both services only listen on `127.0.0.1`; Caddy is the only public entry point.
- The Fineract backend (`apache/fineract` + Postgres) is a separate Docker Compose stack in `~/fineract` on the server. Its image only bundles the PostgreSQL JDBC driver, so MariaDB/MySQL will not work without adding a driver.

## Deploying with Coolify

1. In Coolify, create a new resource: **Docker Compose**, from this repository, branch `main`.
2. Leave the domain empty. Caddy already routes `sacco.byte10x.dev` to `127.0.0.1:14200`.
3. Deploy. The image is built from source on the server (Angular build, several minutes, memory-heavy).

The compose file needs no edits. These values can be overridden in Coolify's Environment Variables tab:

| Variable | Default | Purpose |
|---|---|---|
| `FINERACT_API_URL` | `https://sacco.byte10x.dev` | Fineract server the browser talks to |
| `FINERACT_API_URLS` | `https://sacco.byte10x.dev` | Servers listed on the login page |
| `FINERACT_PLATFORM_TENANT_IDENTIFIER` | `default` | Fineract tenant |

The login page's server selector is disabled (`MIFOS_ALLOW_SERVER_SWITCH_SELECTOR=false`) so staff cannot point the app at another server. Every other setting (languages, session timeout, OAuth, and so on) is documented in the [upstream README](https://github.com/openMF/web-app#configuration-options).

### Caddy route (already on the server)

```
sacco.byte10x.dev {
	reverse_proxy /fineract-provider/* localhost:18080
	reverse_proxy localhost:14200
}
```

## Setting up UGX in Fineract

Currency is configured in the backend, not in code:

1. **Admin → Organization → Currency Configuration**: add **UGX**, remove USD.
2. On every savings, share and loan product, set **decimal places to 0**. Fineract's default for UGX is 2.

## Local development

Requires Node.js 24.

```bash
npm ci
npm start          # http://localhost:4200
```

To develop against the live backend, set `FINERACT_API_URL=https://sacco.byte10x.dev` in `src/assets/env.js`, or use the proxy options described in the [upstream README](https://github.com/openMF/web-app#proxy-configuration).

Build the production image locally exactly as Coolify does:

```bash
docker compose build
```

## Keeping up with upstream

```bash
git remote add upstream https://github.com/openMF/web-app.git   # once
git fetch upstream
git merge upstream/dev
```

Conflicts are most likely in `src/assets/translations/*.json` (branding) and the two dashboard files:

- `src/app/analytics/services/analytics-data-source.service.ts`
- `src/app/system/manage-dashboards/manage-dashboards.component.ts`

## Licence

Mozilla Public License 2.0, inherited from Mifos X Web App. See [LICENSE](LICENSE).

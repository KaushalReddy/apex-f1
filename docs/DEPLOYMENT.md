# APEX F1: Deployment

How to run APEX F1 in production on one Linux server with Docker. Everything is in the repository: `docker-compose.yml` (the
services), `docker-compose.prod.yml` (the production overlay), `infra/caddy/Caddyfile` (HTTPS), `infra/deploy/` (settings template,
deploy script, smoke test).

## What runs

| Service | Role | Public? |
|---|---|---|
| `caddy` | HTTPS entry point: certificate from Let's Encrypt, renewed automatically; `/api/sessions/*` to the API, everything else to the site | yes (80, 443) |
| `web` | The Next.js site (standalone build), unprivileged user, health-checked | no |
| `sync` | OpenF1 sync worker (`--watch`): new races, telemetry and standings every 30 min, then refreshes the affected pages | no |
| `api` | Java replay API (Spring) over Postgres | no |
| `postgres` | Database for the API | no |

All restart on their own (`restart: unless-stopped`). The site and the worker share the `apexdata` volume, which is why one host with a
persistent disk is required (serverless hosting would need the data store moved to object storage or Postgres first).

Not in production images: the CFD solver (the Car Lab shows the shipped CFD results and says new runs are not available on this
server) and the optional `ai` placeholder service.

## Server requirements

- Linux with Docker Engine and Docker Compose 2.24 or newer (`docker compose version`).
- 2 vCPU and 4 GB RAM (the Next.js and Java builds run on the server; with 2 GB add swap).
- About 10 GB of disk.
- A domain whose A/AAAA record points at the server; ports 80 and 443 open (Caddy needs both to obtain the certificate).

## First deploy

```sh
git clone https://github.com/KaushalReddy/apex-f1.git && cd apex-f1
cp infra/deploy/env.production.example .env
# Fill in .env: DOMAIN, POSTGRES_PASSWORD and APEX_DB_PASSWORD (the same value), SYNC_SECRET; optionally GEMINI_API_KEY.
#   openssl rand -hex 24   # database password
#   openssl rand -hex 32   # SYNC_SECRET
chmod 600 .env
sh infra/deploy/deploy.sh
```

The script checks the required settings, builds and starts the stack, waits until the site reports healthy, then runs the smoke test
against `https://DOMAIN`. On a first deploy the smoke test may warn that the data is stale: the worker's first run takes a few minutes
(it rebuilds the season results from OpenF1), after which `/api/data-status` reports `fresh`.

## Updating

```sh
sh infra/deploy/deploy.sh   # pulls main, rebuilds, restarts, waits for health, smoke-tests
```

Synced data, the database and the HTTPS certificate live in volumes and survive updates. Race data needs no deploy at all: the
worker adds each race about 90 minutes after it ends and finalises it the next day.

## Rolling back

```sh
git checkout <previous commit>
sh infra/deploy/deploy.sh --no-pull
git checkout main            # when the fix is on main again, deploy normally
```

## Checking on it

```sh
sh infra/deploy/smoke.sh https://DOMAIN                       # pages, a replay download, 404s, headers, data freshness, protected routes
SYNC_SECRET=... sh infra/deploy/smoke.sh https://DOMAIN       # also the worker's full record
curl -s https://DOMAIN/api/data-status                         # public: fresh / stale / failing, last successful sync
curl -s -H "authorization: Bearer $SYNC_SECRET" https://DOMAIN/api/sync/health   # per-race sync times, last run, failures
docker compose -f docker-compose.yml -f docker-compose.prod.yml ps
docker compose -f docker-compose.yml -f docker-compose.prod.yml logs -f --tail=100 sync   # or web, caddy, api
```

`stale` for longer than an hour, or `failing`, means the worker is not completing runs: its log names the failure category
(`rate-limit`, `unavailable`, `invalid-output`, ...; tools/openf1-sync/README.md). The site keeps serving the last good data meanwhile.

## Backups

| Volume | Contents | If lost |
|---|---|---|
| `pgdata` | API database | back up: `docker compose ... exec postgres pg_dump -U apex apex > apex.sql` |
| `apexdata` | Synced races, telemetry, standings | re-created by the worker's next run (about 6 minutes for a season) |
| `caddy_data` | HTTPS certificate and keys | re-issued automatically (mind Let's Encrypt's weekly limits if it keeps happening) |

## Secrets

- `.env` holds every secret, stays on the server (`chmod 600`) and is never committed (`.gitignore`).
- Rotating `SYNC_SECRET`, the database password or `GEMINI_API_KEY`: edit `.env`, then `sh infra/deploy/deploy.sh --no-pull`. For the
  database password, change it in Postgres first (`ALTER USER apex PASSWORD '...'`).
- Nothing secret reaches the browser: OpenF1 and Gemini credentials are read only on the server.

## Security in place

- Only Caddy is reachable from outside; the site, API and database are on the private compose network.
- HTTPS everywhere, with HSTS; security headers on every response (no framing, no MIME sniffing, referrer policy, permissions policy).
- Caddy replaces client-sent `X-Forwarded-For`, so per-visitor limits hold: the Race Engineer allows 12 questions per 10 minutes and
  new CFD runs 6 per hour per visitor. The limits are kept in memory per server process, which is right for this one-server setup.
- Containers run as unprivileged users.

## Not verified from the development machine

Docker is not available where this was prepared, so the images and the compose stack have not been built or started as a whole. What
was verified: the production build serving synced data with the production settings, the smoke test against it (all checks, and a
failure when the secret is wrong), the web health-check command, the sync worker against the real OpenF1 API, the API's tests with
its new database settings, and the compose overlay's structure. The first real deploy is the end-to-end test.

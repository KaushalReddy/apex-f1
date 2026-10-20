# APEX F1

Race intelligence for fans who watch the gaps, not just the order. Every car, every lap, on the real circuit: replay a Grand Prix in
3D, lay two drivers' laps over each other, follow the tyre strategy, and ask a race engineer why the order changed. Built on OpenF1
timing data.

APEX F1 is an independent project. It is not affiliated with, endorsed by or connected to Formula 1, the FIA or any team. Timing data
comes from [OpenF1](https://openf1.org), an unofficial community API. Calculated values, simulations and AI answers are labelled where
they appear.

## What it does

| Area | Route | What you get |
|---|---|---|
| Live | `/live` | Live timing when a session is running (needs an OpenF1 subscription); otherwise the latest Grand Prix replayed in 3D, with a countdown to the next race |
| Race Replay | `/replay` | A whole Grand Prix on its 3D circuit, every car where it really was: scrub, compare two drivers, race control and weather, rewind a battle |
| Telemetry Lab | `/telemetry` | Two fastest laps, trace against trace: speed, throttle, brake, gear and RPM, with both cars on the circuit |
| Strategy | `/strategy` | Tyre stints, pit stops and degradation for the whole field, with a clearly labelled what-if |
| Race Engineer | `/race-engineer` | Questions about a race in plain English, answered by Google Gemini only from the race data, every look-up shown |
| Drivers, Teams, Standings | `/drivers`, `/teams`, `/standings` | Profiles, season results and form, head-to-heads, both championships after every round |
| Circuits | `/circuits` | Every Grand Prix venue since 2023, rebuilt in 3D from real car positions where the data allows; replay the latest race there |
| Car Lab | `/cars` | A procedural car per team: take it apart in 3D, airflow, wing setups, and real 2D CFD results (SU2) |

Race data refreshes on its own: a sync worker adds each race about 90 minutes after it ends, with no redeploy.

## Quick start

Requirements: Node.js 22 and npm. The site ships with a data snapshot (2024-2026 results and standings, the 2026 races), so it runs without any account or database.

```sh
cd apps/web
npm ci
npm run dev            # http://localhost:3000
```

Optional extras, each in `apps/web/.env.local` (copy `apps/web/.env.example`; never commit it):

| Setting | Enables |
|---|---|
| `GEMINI_API_KEY` | The Race Engineer (otherwise it says it is not configured) |
| `OPENF1_USERNAME`, `OPENF1_PASSWORD` | Live timing during sessions (paid OpenF1 subscription) |
| `DATA_DIR` | Newer data from the sync worker. Use one absolute path for both: `DATA_DIR=/abs/path node tools/openf1-sync/sync.mjs --once` from the repository root |

The whole stack (site, sync worker, Java API, Postgres) runs with `cp .env.example .env && docker compose up --build`.

## Tests

```sh
cd apps/web
npm run lint && npm run typecheck
npm test                                  # unit tests (Vitest)
npm run build && npm run verify:routes    # production build, then crawl every linked page
npx playwright install chromium && npm run test:e2e   # browser tests, desktop and phone, with accessibility checks (after a build)
node --test "../../tools/**/*.test.mjs"   # sync worker and OpenF1 client
cd ../api && mvn verify                   # Java API (needs Postgres, see .github/workflows/ci.yml)
```

CI (`.github/workflows/ci.yml`) runs all of these on every push.

## Deploying

One Linux server with Docker, Caddy in front for HTTPS: `sh infra/deploy/deploy.sh` after filling in `.env` from
`infra/deploy/env.production.example`. Step by step, with monitoring, backups and rollback: [docs/DEPLOYMENT.md](docs/DEPLOYMENT.md).

## Documentation

| Document | Covers |
|---|---|
| [ARCHITECTURE.md](docs/ARCHITECTURE.md) | System overview, repository layout, architecture decisions (ADRs) |
| [DATA_PIPELINE.md](docs/DATA_PIPELINE.md) | How OpenF1 data is fetched, validated, synced and served; live timing |
| [DATA_MODEL.md](docs/DATA_MODEL.md) | Every dataset the site reads, and the API's database |
| [3D_ENGINE.md](docs/3D_ENGINE.md) | Circuits, cars, the race view, coordinates and performance |
| [DESIGN_SYSTEM.md](docs/DESIGN_SYSTEM.md) | Tokens, components, states, accessibility |
| [COPY_STYLE.md](docs/COPY_STYLE.md) | How the product's text is written |
| [DEPLOYMENT.md](docs/DEPLOYMENT.md) | Production runbook |
| [ROADMAP.md](docs/ROADMAP.md) | Phases 0-19 and what each delivered |

Tool READMEs: `tools/openf1-sync`, `tools/openf1-replay`, `tools/openf1-spike`, `tools/cfd`; data READMEs under
`apps/web/src/data/`.

## Data and credits

- Timing, positions, results and schedules: [OpenF1](https://openf1.org) (unofficial; data originates from Formula 1 timing).
- Circuit facts (length, turns, type, direction, lap records): Wikipedia, with the source shown on each circuit page.
- Fonts: self-hosted, licences in `apps/web/src/fonts/README.md`.
- Driver portraits (`apps/web/public/drivers/`): supplied by the project owner; their usage rights need to be cleared before a public
  launch.
- There is no licence file yet, so the code is all rights reserved by default until the owner chooses one.

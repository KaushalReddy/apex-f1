# APEX F1: Architecture

Status (October 2026): Phases 0-18 are built (see `ROADMAP.md`); deployment is prepared for one Docker host (`DEPLOYMENT.md`).
OpenF1 behaviour described here has been measured against the real API (`DATA_PIPELINE.md`), except live timing, which needs a paid
subscription and is tested against mocked responses only.

## 1. System overview

```
                    ┌────────────── tools/ (Node, Python) ──────────────┐
OpenF1 (history) ─► │ openf1-replay · openf1-telemetry · openf1-results │ ─► JSON datasets ─┬─► bundled with the build
                    │ openf1-spike (geometry) · circuit-catalog         │                   └─► DATA_DIR volume
                    │ openf1-sync: runs the exporters on a schedule ────┘                          │
                    └───────────────────────────────────────────────────                         ▼
OpenF1 (live, paid) ─────────────────────────────────────────────► apps/web (Next.js 16, React 19, three.js / R3F)
Google Gemini ◄── /api/engineer (tools over the same datasets) ◄──┤  pages (ISR), /api/replay, /api/live, /api/engineer, ...
                                                                   │
apps/api (Spring Boot, Postgres) ◄── /api/sessions/... ────────────┘  replay timeline, /live fallback only
Caddy (HTTPS) in front of everything in production
```

Rules that never bend:
1. The browser talks only to **our** server. No third-party calls or keys in the frontend.
2. Pages depend on **validated, normalized datasets**, never on raw OpenF1 payload shapes.
3. Live and replay drive the **same race view**; only the source differs.
4. The AI engineer sees race data **only through our tools** over those datasets, which is what makes "never fabricate telemetry"
   enforceable.

## 2. Repository layout

```
apex-f1/
├─ apps/web             Next.js site: pages, API routes, 3D engine (lib/ is pure, tested TypeScript; components/ are thin)
├─ apps/api             Spring Boot 3.5 / Java 21 + Postgres (Flyway): OpenF1 ingestion and the replay timeline
├─ apps/ai              FastAPI placeholder (/health); the engineer runs in apps/web (ADR-020)
├─ packages/contracts   JSON Schemas: PositionFrame, CircuitGeometry
├─ tools/               OpenF1 exporters (replay, telemetry, results), sync worker, geometry spike, circuit catalog, CFD (SU2)
├─ infra/docker         one Dockerfile per service (web, api, sync, ai)
├─ infra/caddy          HTTPS entry point for production
├─ infra/deploy         production settings template, deploy script, smoke test
├─ docs/
├─ docker-compose.yml        postgres, api, web, sync (+ ai via --profile ai)
├─ docker-compose.prod.yml   production overlay: Caddy public, everything else private
└─ .github/workflows/ci.yml  lint, typecheck, unit, sync, build, route crawl, browser tests; mvn verify; pytest
```

## 3. Architecture decision records

**ADR-001 Monorepo, no build orchestrator.** Plain folders; each app builds with its own tool.
Add Turborepo/Nx only if cross-app build caching becomes a real cost.

**ADR-002 Provider abstraction.** `LocationProvider` (and later session/lap/stint/weather
providers) are interfaces in `apps/api`. OpenF1 and Jolpica are implementations. Swapping a
source means adding an implementation, not touching services, WebSocket or frontend.

**ADR-003 One PositionFrame for LIVE and REPLAY.** Live: provider poll/stream -> normalize ->
publish. Replay: read stored chunks -> same normalize/publish path. `mode` is a label on the
frame. Clients interpolate between `sampleT` timestamps and never snap.

**ADR-004 Circuit geometry is derived from location data. STATUS: ACCEPTED (spike run on every circuit since 2023; 0.1 m units confirmed; crossovers use windowed projection).** The centerline is
built from clean-lap `/location` samples so cars and track share one coordinate system by
construction, with no licensed circuit assets. Accepted only if the spike passes on several
circuits. Fallback: a sourced, licensed layout plus a fitted transform.

**ADR-005 PostgreSQL holds history; replay is stored as time-window chunks (proposed). Outcome: the API stores per-sample rows; the
website's replays became files (ADR-021).**
Per-sample rows are simple but large; chunked arrays are compact and fast to window. Final
choice waits for real sample rates and volumes from the spike (see `DATA_MODEL.md`).

**ADR-006 Redis is deferred.** Not in compose, not in dependencies. Introduce it only when one
of these is demonstrated: (a) more than one API instance needs shared live-session state or
WebSocket fan-out, (b) measured read latency on hot live data that Postgres + in-process cache
cannot meet, (c) rate-limit coordination across instances. A single-instance live session does
not need it.

**ADR-007 WebSocket transport (proposed, decide in Phase 5). Outcome: not built; replays are files played in the browser and live
timing is polled on demand (ADR-021).** Spring WebSocket. Leaning to a
plain WebSocket with JSON frames (binary later if payload size demands) over STOMP, because we
need one-way broadcast per session, not routing semantics. Revisit with load numbers.

**ADR-008 FastAPI stays thin and late.** `apps/ai` is a health-check placeholder so Docker/CI
shape is settled. No model or provider code before Phase 14.

**ADR-009 Dependencies are added when first used.** No Three.js/R3F/Framer Motion, JPA, Flyway
or Postgres driver in the scaffold. Each arrives with the phase that needs it.

**ADR-010 CI/Docker foundations only.** CI runs web lint/typecheck/build, `mvn verify`, Python
tests and schema validation. Compose runs postgres/api/web. No deploy pipeline yet.

**ADR-011 Server components by default (Phase 1; the principle holds, the counts below are Phase 1's).** Every page and presentational component is a
server component. Only four files are client components, each for a real browser need:
`nav-link` (active route via `usePathname`), `mobile-nav` (disclosure state, Escape),
`info-tip` (hover/focus/Escape tooltip) and `error.tsx` (required by Next). All 15 routes are
statically prerendered.

**ADR-012 Design tokens live in CSS (`@theme` in `globals.css`).** Components reference token
names (`bg-surface`, `text-muted`, `border-line`), never raw hex. See `DESIGN_SYSTEM.md`.

**ADR-013 System font stacks for now (superseded: fonts are now self-hosted with `next/font/local`, licences in `src/fonts/README.md`).** Fetching web fonts at build time needs network access to
a font host, and a font file's licence must be chosen deliberately. A self-hosted font is a
deliberate later decision, not a Phase 1 side effect.

**ADR-014 Preview content policy (Phase 1; real OpenF1 data replaced the previews, which remain only as labelled fallbacks).** Static preview content lives only in `src/domain/demo.ts`:
names, codes and colours, with no results, points, ratings or lengths. Every use is labelled
"Static preview". Demo line-ups and colours are **[VERIFY]**. Replaced by DTOs from the API in
Phase 2+; the page components do not change shape.

**ADR-015 Navigation is data.** `src/domain/navigation.ts` is the single source for header,
mobile menu, footer, homepage capability cards and roadmap-phase badges. `LiveIndicator` takes a
`SessionStatus` prop (`none | live | replay`) so Phase 5 only has to supply the value.

**ADR-016 No Three.js until Phase 3.** The shell reserves no canvas and ships no 3D code. 3D
components will live in `src/components/3d/` and be loaded with `next/dynamic` so they stay out of
non-3D routes.

**ADR-017 Circuit engine (Phase 3).** three + @react-three/fiber + @react-three/drei, client-only via `next/dynamic` with
`ssr: false`, behind an error boundary. Pure TypeScript (`lib/circuit`: validation, transform, mesh builders, camera framing) holds the
logic and is unit-tested; React components are thin. The scene renders on demand. Details in `docs/3D_ENGINE.md` sections 6 to 9.
ADR-016 is superseded by this: three.js now exists, loaded only by the circuit page.

**ADR-018 One coordinate transform for track and cars.** `createWorldTransform` is the only place source (OpenF1) coordinates become
Three.js coordinates, shared to scene children via context. Source values are never altered in the backend or the artifacts.

**ADR-019 Geometry artifacts are generated, deterministic and honest about scale.** Produced by `tools/openf1-spike --export-geometry`,
committed under `apps/web/src/data/circuits/`, validated at load, and labelled "scale not calibrated" unless the spike supports it.
A missing artifact shows an explicit empty state; no layout is ever guessed.

**ADR-020 The Race Engineer runs in the web app, not `apps/ai` (Phase 14; supersedes the AI part of ADR-008).** Race data lives in
the exported replay files and is analysed by tested TypeScript (`lib/replay`, `lib/strategy`). The engineer is a Next.js route
(`/api/engineer`) using Google Gemini through its official SDK (`@google/genai`; model `gemini-2.5-flash` unless `GEMINI_MODEL` is set); its tools (`lib/engineer/tools.ts`) call that same code, so its numbers
match the pages and rule 4 holds in spirit: the model sees race data only through our tools. The key (`GEMINI_API_KEY`) stays on the
server; without it the page and replay panel say "not configured". In the replay, the dataset is cut at the replay moment before any
tool runs, so answers cannot spoil the rest of the race. `apps/ai` stays a placeholder.

**ADR-021 Data updates without redeploys: a sync worker writing a shared directory, read before the bundled snapshot.** The web app
stays file-based (no database added): race data are immutable per-session documents read whole, so a persistent directory (`DATA_DIR`)
written atomically by one worker (`tools/openf1-sync`, reusing the export tools) and read by the site, with the build's snapshot as
fallback, meets the need with the least machinery. Pages refresh by ISR plus a secret-protected `/api/revalidate`. Live timing is a
separate, server-side, on-demand polled feed (`apps/web/src/lib/openf1`) because the hosting choice is open; MQTT is the upgrade path once a
persistent process exists. Requires a host where the web server and the worker share a disk; object storage or Postgres behind
`lib/data/store.ts` is the change for hosts without one.

**ADR-022 One Docker host for production (Phase 18).** The site and the sync worker must share a disk (ADR-021), so production is
one Linux server running the compose stack, with Caddy as the only public service (automatic HTTPS, real client addresses for rate
limits) and the site, API and database on the private network. Serverless hosting would first need `lib/data/store.ts` moved to
object storage or Postgres. Runbook: `DEPLOYMENT.md`.

## 4. What exists today

| Area | State |
|---|---|
| web | 21 page routes and 12 API routes; 411 unit tests, 52 browser tests (desktop and phone, axe), route crawl of 121 pages |
| api | Spring Boot with Postgres (Flyway), OpenF1 session and position ingestion, replay timeline; `mvn verify` passes |
| tools | exporters and the sync worker (23 tests), geometry spike (pytest), circuit catalog, CFD pipeline |
| ai | FastAPI `/health` placeholder |
| Docker | Dockerfiles, compose stack and production overlay written; not built on the development machine (no Docker there) |

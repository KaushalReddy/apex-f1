# APEX F1: Architecture

> **OPENF1 VALIDATION STATUS: BLOCKED, NOT YET VALIDATED.** The sandbox used for Phase 0 cannot reach
> `api.openf1.org` (HTTP 403 `host_not_allowed`). No OpenF1 measurement exists anywhere in this repo.
> Every OpenF1 behaviour described in these docs is an assumption until the owner runs the spike
> (`tools/openf1-spike`) from a machine with network access and the results are reviewed.

Status: **Phase 0 (foundation).** Nothing here is built beyond the scaffold. Items marked
**[VERIFY]** are assumptions about third-party behaviour that the OpenF1 spike must confirm.
The spike has been implemented but **not yet run against the real API** (see `DATA_PIPELINE.md`).

## 1. System overview

```
OpenF1 ─┐
        ├─► apps/api (Spring Boot)
Jolpica ┘    provider/   : LocationProvider, ... (one impl per source)
             service/    : normalization, ingestion, replay reads   (Phase 2+)
             dto/        : provider-agnostic records
             web/ + ws/  : REST + WebSocket
                │
                ├─► PostgreSQL  (history, replay chunks, circuit geometry)
                │
                ├─► WebSocket / REST ─► apps/web (Next.js + React Three Fiber)
                │
                └─► REST (tool calls) ◄─ apps/ai (FastAPI, Phase 14)
```

Rules that never bend:
1. The browser talks only to **our** backend. No third-party calls or keys in the frontend.
2. Frontend and AI service depend only on **normalized DTOs** (`packages/contracts`), never on
   OpenF1/Jolpica payload shapes.
3. LIVE and REPLAY emit the **same `PositionFrame`**; only the source differs.
4. The AI service reads race data **only through our API**, which is what makes "never fabricate
   telemetry" enforceable.

## 2. Repository layout

```
apex-f1/
├─ apps/web        Next.js + TS + Tailwind (R3F added in Phase 3)
├─ apps/api        Spring Boot 3.5 / Java 21 (health endpoint + provider interface only)
├─ apps/ai         FastAPI placeholder (/health only) until Phase 14
├─ packages/contracts   JSON Schemas: PositionFrame, CircuitGeometry
├─ infra/docker    one Dockerfile per app
├─ infra/github    notes (GitHub only reads .github/workflows at repo root)
├─ tools/openf1-spike   the data spike (Python, numpy)
├─ docs/
├─ docker-compose.yml   postgres + api + web (+ ai via --profile ai)
└─ .github/workflows/ci.yml
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

**ADR-004 Circuit geometry is derived from location data. STATUS: PENDING VALIDATION (spike blocked by sandbox network restriction; not accepted yet).** The centerline is
built from clean-lap `/location` samples so cars and track share one coordinate system by
construction, with no licensed circuit assets. Accepted only if the spike passes on several
circuits. Fallback: a sourced, licensed layout plus a fitted transform.

**ADR-005 PostgreSQL holds history; replay is stored as time-window chunks (proposed).**
Per-sample rows are simple but large; chunked arrays are compact and fast to window. Final
choice waits for real sample rates and volumes from the spike (see `DATA_MODEL.md`).

**ADR-006 Redis is deferred.** Not in compose, not in dependencies. Introduce it only when one
of these is demonstrated: (a) more than one API instance needs shared live-session state or
WebSocket fan-out, (b) measured read latency on hot live data that Postgres + in-process cache
cannot meet, (c) rate-limit coordination across instances. A single-instance live session does
not need it.

**ADR-007 WebSocket transport (proposed, decide in Phase 5).** Spring WebSocket. Leaning to a
plain WebSocket with JSON frames (binary later if payload size demands) over STOMP, because we
need one-way broadcast per session, not routing semantics. Revisit with load numbers.

**ADR-008 FastAPI stays thin and late.** `apps/ai` is a health-check placeholder so Docker/CI
shape is settled. No model or provider code before Phase 14.

**ADR-009 Dependencies are added when first used.** No Three.js/R3F/Framer Motion, JPA, Flyway
or Postgres driver in the scaffold. Each arrives with the phase that needs it.

**ADR-010 CI/Docker foundations only.** CI runs web lint/typecheck/build, `mvn verify`, Python
tests and schema validation. Compose runs postgres/api/web. No deploy pipeline yet.

## 4. What exists today

| Area | State |
|---|---|
| web | Next.js app shell page; lint, typecheck, build verified locally |
| api | Spring Boot skeleton, `HealthController`, `LocationProvider`, `PositionSample`; **not built here** (no Maven/JDK toolchain in this environment) |
| ai | FastAPI `/health` + test; passes |
| contracts | 2 JSON Schemas, syntax-validated |
| spike | implemented, offline algorithm tests pass; **never run against OpenF1** |
| Docker | Dockerfiles + compose written; **not built** (no Docker in this environment) |

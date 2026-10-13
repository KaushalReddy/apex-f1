# APEX F1: Roadmap

> **Phase 0 is incomplete on one item:** OpenF1 validation is blocked by the sandbox network
> restriction and must be run manually (see `docs/DATA_PIPELINE.md`, "Manual validation").
> ADR-004 (geometry from location data) is **pending validation**. Phase 2 and Phase 3 stay gated on it.

Each phase ends with a summary and a STOP for approval. Status as of Phase 0.

| # | Phase | Status |
|---|---|---|
| 0 | Repo audit, scaffold, docs, OpenF1 spike | **Scaffold + docs done. Spike implemented, NOT yet run (needs network access to api.openf1.org).** |
| 1 | Design system + app shell (+ CI/Docker already in place) | **implemented, awaiting approval** (see DESIGN_SYSTEM.md) |
| 2 | Data ingestion (providers, DTOs, Postgres schema, caching) | not started; **gated on spike** |
| 3 | 3D circuit engine (one circuit) | not started; gated on spike |
| 4 | Multi-team procedural 3D car system and aerodynamics explorer (`/cars/[team]`) | **implemented, awaiting approval** (see 3D_ENGINE.md section 10) |
| 5 | Live race experience at `/live`: glowing team-coloured driver markers on the 3D circuit, race order, events, DEMO (simulated) and REPLAY sources; LIVE provider interface only | **implemented, awaiting approval** (see 3D_ENGINE.md section 11). No live provider is configured. |
| 6 | Driver experience and standings: directory, profiles, season trends, head-to-head, drivers' and constructors' championships (`/drivers`, `/drivers/[driver]`, `/drivers/compare`, `/standings`) from OpenF1 season snapshots | **implemented, awaiting approval** (see `apps/web/src/data/results/README.md`) |
| 7-9 | Team, car lab, circuit explorer pages | not started; mostly independent |
| 10-15 | Telemetry lab, replay, weather/race control, strategy, AI engineer, Race Rewind | not started |
| 16-19 | Performance, tests, deploy, docs | not started |

## Gate before Phase 2

Run `tools/openf1-spike` and review its reports. Phase 2's storage design and Phase 3's
geometry approach both depend on: sample rate and gaps, coordinate unit, centerline quality,
cross-driver consistency, behaviour on a crossover circuit (Suzuka). Possible outcomes:
- **Pass:** proceed with ADR-004 as written.
- **Pass with caveats:** add windowed (tracked) projection for crossover circuits.
- **Fail:** switch ADR-004 to a sourced layout plus fitted transform; re-plan Phase 3.

## Suggested ordering changes versus the original prompt

- Pull CI and Docker forward (done in Phase 0).
- Do the spike before any ingestion design (this phase).
- Defer Redis (ADR-006) and FastAPI (ADR-008).
- Treat live access as unconfirmed: build replay-first, make live a source switch **[VERIFY]**.
- Phases 6-9 are content pages and can be interleaved after Phase 5 if momentum needs a
  visible win.

## Open questions for the owner

1. Is paid/authenticated OpenF1 real-time access acceptable, or is replay-only fine for v1?
2. Which circuit should be the single Phase 3 circuit (decided after the spike matrix)?
3. Deployment targets for backend and Postgres (Phase 18); any budget limits?

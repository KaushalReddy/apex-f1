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
| 6 | Driver experience and standings: directory, profiles, season trends, head-to-head, drivers' and constructors' championships (`/drivers`, `/drivers/[driver]`, `/drivers/compare`, `/standings`) from OpenF1 season snapshots | done (see `apps/web/src/data/results/README.md`) |
| 7 | Team experience: eleven-team directory with livery cards, team profiles (line-up, constructors' standing, results, trends), team head-to-head (`/teams`, `/teams/[team]`, `/teams/compare`) from the same OpenF1 snapshots | done |
| 8 | Car Lab: component tree, selection, hide, isolate, x-ray, explode amount, labels, camera focus, focused conceptual airflow, A/B wing setup explorer with relative indices (`/cars/[team]/lab`) on the Phase 4 procedural car plus a real CFD pipeline (SU2 RANS-SA via `tools/cfd`) for a 2D rear-wing section and the NASA TMR NACA 0012 verification case; full-car 3D CFD not feasible on this setup | implemented, awaiting approval |
| 9 | Circuit library and explorer: 26-circuit catalog (every GP venue since 2023; facts from Wikipedia, events from OpenF1, `tools/circuit-catalog`), 25 layouts from OpenF1 car positions (Sepang has none: reconstruction failed its checks), directory with search/filter/sort (`/circuits`), full-window explorer with views, markers, history and provenance (`/circuits/[circuit]`), simulated race on any layout (`/live?circuit=`); website QA pass; compact tabbed CFD workspace in the Car Lab | implemented, awaiting approval |
| 10 | Telemetry Lab (`/telemetry`): two drivers' fastest laps of any exported 2026 Qualifying or Race session (OpenF1 car and position data via `tools/openf1-telemetry`), speed/throttle/brake/gear/RPM against track distance or lap time, derived gap trace, both cars on the 3D circuit at the same elapsed time; invalid feed samples shown as gaps; linked from driver profiles and the circuit explorer | implemented, awaiting approval |
| 11 | Race Replay (`/replay`, `/replay/[session]`): full recorded 2026 races from OpenF1 (`tools/openf1-replay`: positions, official order, gaps, laps, pit stops, race control) on the 3D circuit; monotonic replay clock (play, pause, seek, ±10 s, 0.5–30×), timeline with Safety Car/VSC periods and pit-stop markers, events that seek; `/live` shows the full previous race when nothing is live. Extensions: Compare Drivers (race time, laps, lap-distance comparison with fastest-lap telemetry, chart/replay sync) and Circuit Focus (hollowed-out markers) | implemented, awaiting approval |
| 12 | Weather & Race Control, inside the Race Replay (and Live): track status calculated from OpenF1 race-control messages (green, sector yellows, VSC, Safety Car, red flag, finish), a time-synced Race Control feed (key moments / all, click to seek), weather at the replay moment and through the race (`/weather`, about one reading a minute), red-flag and Safety Car periods on the timeline, and approximate yellow-sector shading on the circuit (marshal-sector positions are not published) | implemented, awaiting approval |
| 13 | Strategy (`/strategy?session=&driver=`): OpenF1 tyre stints and pit stops for the whole field (stint chart with Safety Car / VSC / red-flag periods; compound changes without a pit record flagged), per-driver pace on comparable laps with a fitted degradation trend ± standard error, and a what-if for moving a stop, always labelled SIMULATION with its assumptions and range; stint strip and link in the replay's Compare panel | implemented, awaiting approval |
| 14-15 | AI engineer, Race Rewind | not started |
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

# APEX F1: Data model

Two stores, for two jobs. The website is file-based: race data are immutable per-session documents, exported once from OpenF1 as
validated JSON and read whole (ADR-021). The Java API keeps a small Postgres database for its replay timeline, now only `/live`'s fallback.

## Website datasets (JSON)

Each kind lives in the build (bundled snapshot) and, when the sync worker runs, in `DATA_DIR` (read first; a damaged synced file falls
back to the bundled one: `apps/web/src/lib/data/store.ts`). Every loader validates before use; an invalid file is reported, never shown.

| Dataset | Bundled at | Written by | Contents | Validated by |
|---|---|---|---|---|
| Race replays | `public/replay/<year>/<sessionKey>.json` + `index.json` | `tools/openf1-replay` | Positions (about 4 Hz per car), official order, gaps, laps and sectors, pit stops, stints, race control, weather, overtakes; each with source timestamps, plus `source.endpoints`, `fetchedOn` and `positionCoverage` | `lib/replay/dataset.ts` |
| Fastest-lap telemetry | `src/data/telemetry/<year>/` | `tools/openf1-telemetry` | Each driver's fastest lap of a Qualifying or Race: speed, throttle, brake, gear, RPM, DRS, position; invalid samples kept as gaps | `lib/telemetry/parse.ts` |
| Season results | `src/data/results/<year>.json` | `tools/openf1-results` | Official classifications per race, drivers and teams (colours, numbers), championship standings as published | `lib/drivers/load.ts` |
| Circuit catalog | `src/data/circuits/catalog.json` | `tools/circuit-catalog` | 26 circuits: facts from Wikipedia with sources, Grands Prix and the 2026 calendar from OpenF1 `/meetings` | `lib/circuit/catalog.ts` (+ tests) |
| Circuit geometry | `src/data/circuits/<slug>.geometry.json` | `tools/openf1-spike --export-geometry` | Centerline from car positions (0.1 m units, 2 m steps), derivation and scale verdict | `packages/contracts/schemas/circuit-geometry.schema.json` |
| Sync state | `DATA_DIR/sync-state.json` | `tools/openf1-sync` | Per-session sync times, finalisation, last run counts and failure category; no credentials | `lib/data/status.ts` |
| CFD results | `public/cfd/` | `tools/cfd` | SU2 runs of a 2D rear-wing section and the NACA 0012 verification case | `lib/cfd/model.ts` |

Rules that hold across all of them:
- Source values are stored as received (OpenF1 coordinates, timestamps); conversions happen at read time with a recorded unit.
- Missing data stays missing: gaps are explicit, nothing is interpolated into the file, and pages say what is absent.
- Calculated values (degradation trends, what-ifs, net places, gaps on comparable laps) are computed at read time by tested
  TypeScript and labelled as calculated or simulated where shown.

## API database (Postgres, `apps/api`)

Flyway migration `V1__initial_schema.sql`:

| Table | Key | Contents |
|---|---|---|
| `sessions` | `session_key` | OpenF1 session: circuit key, name, type, year, start and end |
| `position_samples` | `(session_key, driver_number, sample_time_ms)` | One row per location sample: x, y, z in source units |
| `circuit_geometries` | `circuit_key` | Centerline metadata: coordinate system, unit, closed, width, laps used, smoothing, step |
| `circuit_geometry_points` | `(circuit_key, point_index)` | Centerline points |
| `circuit_geometry_sessions` | `(circuit_key, session_key)` | Which sessions a geometry came from |

Per-sample rows (option A of the Phase 0 proposal) were chosen for simplicity; at about 4 Hz, 20 cars and a two-hour race that is
roughly 600,000 rows a session, which is fine for the few sessions the fallback needs. The chunked alternative remains the option if
the API ever stores whole seasons.

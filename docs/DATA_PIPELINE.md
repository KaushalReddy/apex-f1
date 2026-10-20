# APEX F1: Data pipeline

> **Status: validated against the real OpenF1 API.** The spike ran on every circuit with a Grand Prix since 2023 (Phase 9): location
> samples arrive at about 4.17 Hz per car, the coordinate unit is 0.1 m (24 of 25 layouts within 2.5 % of the published length), and
> ADR-004 is accepted. Historical sync was last verified end to end on 2026-10-20. Only live mode is untested against the real API
> (no subscription; mocked responses only). OpenF1 is the only data source: Jolpica, planned in Phase 0, was never needed.

## 1. Flow

```
OpenF1 (historical, no account) ─► export tools (tools/openf1-*) ─► JSON datasets ─┬─► bundled with the build (apps/web/src/data, public/)
                                         ▲                                         └─► DATA_DIR (sync worker, read first) ─► Next.js pages + /api/*
                                         └── tools/openf1-sync runs them on a schedule

OpenF1 (real time, paid) ─► apps/web/src/lib/openf1 (server-side, polled on demand) ─► /api/live ─► /live

OpenF1 ─► apps/api (Spring) ingestion ─► Postgres ─► /api/sessions/.../replay/timeline ─► /live fallback when no recorded race exists
```

- **The site is file-based.** Race data are immutable per-session documents read whole, so they are exported once as validated JSON
  (replays, fastest-lap telemetry, season results, circuit geometry and catalog) rather than stored in a database (ADR-021).
- **The browser never calls OpenF1.** Every request goes to this site's server; credentials stay in server-side environment variables.
- **Rate-limit protection:** one request at a time, at least 2.1 s apart, timeouts, bounded retries with backoff and jitter,
  `Retry-After` honoured, and an on-disk response cache (`tools/openf1-client.mjs`). OpenF1 publishes no numeric limits.
- **Historical data** needs no credentials. **Real-time** data needs a paid OpenF1 subscription (section 6).

## 2. Replay and live

The web app's replays are full recorded races (`tools/openf1-replay`): positions, official order, gaps, laps, pit stops, stints, race
control, weather and overtakes, each with source timestamps, loaded in a Web Worker and played on a monotonic clock. Live timing uses
the same race view with a live source. The Java API's `PositionFrame` path (`packages/contracts`) is the Phase 2 design and now serves
only as `/live`'s fallback for a race with no recorded replay.

## 3. The spike (`tools/openf1-spike`)

Run:
```
cd tools/openf1-spike
pip install -r requirements.txt
python spike.py --year 2024 --circuit Monza --session-name Race --known-length-m 5793
./run_matrix.sh      # Suzuka, Monaco, Monza, Spa-Francorchamps, Silverstone
pytest               # algorithm tests on SYNTHETIC data only
```
Output: `out/<circuit>-<year>/report.json` and `report.md` (local only). It needs `api.openf1.org` reachable. It has been run for
every circuit in the catalog; the layouts it exported, and their verdicts, are listed in `apps/web/src/data/circuits/README.md`.

### Questions -> where the answer appears in the report

| # | Question | Report field |
|---|---|---|
| 1 | `/location` available? | run completes; `drivers.<n>.sampling.n` |
| 2 | Coordinate ranges | `drivers.<n>.x_range / y_range / z_range` |
| 3 | Sampling frequency | `sampling.hz_median`, `dt_p95_s`, `dt_max_s` |
| 4 | Timestamps | `non_monotonic`, `duplicates`, `clock_alignment` |
| 5 | Gaps / missing samples | `gaps_gt_1s`, `gaps_gt_5s`, `largest_gaps_s`, `zero_zero_zero_rows` |
| 6 | Centerline reconstructable? | `centerline.*` (closure gap, length vs known length, racing-line dispersion) |
| 7 | Cars positionable on it? | `leave_one_driver_out_lateral_units`, `all_samples_lateral_units` |
| 8 | Smoothing / resampling needed | `smoothing_sweep` (length change, max shift, roughness per sigma) |
| 9 | More than one circuit? | run the matrix; compare verdicts; `self_proximity_points_within_20m` flags crossovers |

### Method
1. Fetch session, drivers (default 3), full-session `/location` in 30-minute windows, `/laps`.
2. Clean: sort, drop duplicate timestamps and (0,0,0) rows (assumed "no fix").
3. Pick up to 3 fastest clean laps per driver (skip lap 1, pit-out laps, laps over 3% off best).
4. Cut each lap to a closed loop, resample by arclength (about 2 m steps), align start index,
   average across laps/drivers, Gaussian-smooth (sigma 6 m by default).
5. Unit: 0.1 m per unit, confirmed by measurement: with `--known-length-m` the report gives the implied unit (e.g. 0.102 at Albert
   Park), and 24 of 25 layouts fall within 2.5 % of the published length.
6. Consistency: build from driver A, project driver B's laps, report lateral distance percentiles.
7. Positioning: project all samples to the nearest centerline vertex; pit lane/garage show up
   as the far tail (`frac_beyond_40m`).

### Pass criteria (encoded in `verdict()`)
- Length within 2% of the known length under the assumed unit (else the unit is wrong, not the data).
- Cross-driver p95 lateral error at most 8 m.
- No centerline self-proximity within 20 m; if present: **PASS WITH CAVEATS**, meaning nearest-vertex
  projection is ambiguous there and Phase 3 needs windowed projection (search near the previous index).

### Known limits of the spike
- Nearest-vertex projection, not segment projection; fine for pass/fail, refined in Phase 3.
- Centerline is a racing-line average, not the geometric track centre. Track width is unknown
  (`widthMeters: null` in the schema) and must be sourced or estimated from dispersion, never invented.
- Elevation (`z`) is only range-checked, not validated.

## 4. Results and standings

Season results and championship standings come from OpenF1 too (`tools/openf1-results`, `apps/web/src/data/results/README.md`):
official classifications per race, standings as published. Jolpica was not needed.

## 5. Re-running the spike (how it was validated)

1. On a machine that can reach `https://api.openf1.org/v1` (Python 3.10+):
   `cd tools/openf1-spike && pip install -r requirements.txt && pytest`
2. `python spike.py --year 2024 --circuit Monza --session-name Race --known-length-m 5793`
3. `./run_matrix.sh` (Suzuka, Monaco, Monza, Spa-Francorchamps, Silverstone).
   If a circuit name returns "No session", check `circuit_short_name` values via
   `https://api.openf1.org/v1/sessions?year=2024&session_name=Race` and adjust the script arguments.
4. Review `out/<circuit>-2024/report.md` for each. Record per circuit: verdict, `hz_median`,
   `gaps_gt_5s`, `implied_unit_m`, `length_error_pct_with_assumed_unit`, cross-driver p95 lateral,
   `self_proximity_points_within_20m`, best smoothing sigma.
5. ADR-004 was accepted on these reports; crossover circuits (Suzuka, Baku) use the windowed projection the caveat called for.

## 6. Automatic synchronisation (implemented; deployment prepared, see DEPLOYMENT.md)

The site no longer needs a redeploy for new data. Two independent paths:

**Historical (no account).** `tools/openf1-sync` (README there) exports new races, telemetry and season results into `DATA_DIR`, a
persistent directory. The website reads `DATA_DIR` first and the snapshot bundled with its build second (`apps/web/src/lib/data/store.ts`;
a damaged synced file falls back to the bundled one). Race files are served by `/api/replay/<sessionKey>` (streamed, Brotli/gzip, ETag).
Pages that show race data refresh in the background every 15 minutes (ISR) and at once when the worker calls `POST /api/revalidate`
(shared secret). `/api/data-status` reports freshness publicly (source, last successful sync, fresh/stale/failing/bundled);
`/api/sync/health` gives operators the full record behind the same secret. The replay datasets stay the Phase 11 persistence model:
timestamped source records per race (positions, order, gaps, laps and sectors, pit stops, stints, race control, weather, overtakes) with
provenance (`source.endpoints`, `fetchedOn`) and completeness (`positionCoverage`); seeking uses binary search over the time arrays.

**Live (paid OpenF1 subscription).** `apps/web/src/lib/openf1/`: a server-side token manager (`POST /token`, form `username`/`password`,
1 h tokens, renewed a minute early, 5 min cooldown after a rejected login), a REST client with hard limits (spacing, timeout, bounded
retries with jitter, 429 pauses everything until `Retry-After`, circuit breaker, shared identical requests), and a live feed polled **on
demand**: at most one OpenF1 poll set per `OPENF1_LIVE_POLL_MS` for all visitors, nothing when nobody watches, incremental (`date>`),
deduplicated and bounded. `/api/live` serves it; `/live` shows it with source time vs retrieval time, and "Reconnecting" with the age of
the last data when a poll fails. Without credentials, live is reported as unavailable with the next session from the public schedule.

Why polling, not MQTT: OpenF1 also pushes over MQTT (`mqtt.openf1.org:8883`) and WebSocket (`wss://mqtt.openf1.org:8084/mqtt`), using
the token as password, which is the better transport once a persistent process exists. On-demand polling works on every host,
including serverless; on the prepared Docker host (Phase 18) a persistent worker could later feed the same `LiveFeed` state from MQTT.

**Verified vs not verified.** Real OpenF1 historical requests were made (session discovery, a full sync of the 2026 season results, an
idempotent second run). Live mode is tested only against mocked responses: no subscription was available and no session was running
(next: US GP, 23 Oct 2026). OpenF1 publishes no numeric rate limits; the pacing above is conservative and configurable. Deprecations noted
from the docs: `drivers.country_code` and `pit.pit_duration` are removed after 2026 (the exporters already tolerate both being absent).

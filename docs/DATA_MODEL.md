# APEX F1: Data model (proposed, Phase 2 finalizes)

PostgreSQL. Not implemented: no JPA/Flyway in the scaffold (ADR-009). Names are provisional.
Internal DTOs mirror these; provider keys (e.g. OpenF1 `session_key`) are kept as
`provider_*` columns so a second provider can coexist.

## Core entities
| Table | Purpose | Key columns |
|---|---|---|
| `circuit` | one per physical circuit | id, name, country, length_m (sourced) |
| `circuit_geometry` | derived centerline versions | circuit_id, version, coordinate_system, unit_meters, points (array/geometry), derivation (jsonb) |
| `session` | race, quali, practice | id, provider, provider_session_key, circuit_id, type, starts_at, ends_at |
| `driver` | person | id, code, name, nationality |
| `session_driver` | driver in a session | session_id, driver_id, number, team_id |
| `team` | constructor | id, name, color |
| `lap` | one row per driver lap | session_id, driver_id, lap_number, started_at, duration_ms, sectors, is_pit_out |
| `stint` / `pit_stop` | strategy | session_id, driver_id, compound, lap range / lap, duration |
| `weather_sample`, `race_control_event` | environment | session_id, t, ... |
| `ingestion_run` | provenance + idempotency | provider, endpoint, window, status, fetched_at, row_count |

## Position storage (the big one)

Volume estimate, assuming about 3.7 Hz **[VERIFY]**, 20 drivers, a 2-hour window:
3.7 x 7,200 x 20 = about 533,000 samples per session. A season of 24 races is roughly 12.8 M
rows if stored per sample.

| Option | Pros | Cons |
|---|---|---|
| A. `position_sample` row per sample (session, driver, t, x, y, z) | simple SQL, easy ad-hoc queries | large; many index pages |
| B. `position_chunk` per driver per N seconds (arrays or compressed bytea) | compact, one read per playback window | needs decode step; harder ad-hoc queries |

**Leaning B** for replay with N around 60 s (about 220 samples per chunk, about 2,400 chunks per
session), decided after the spike reports real rates and gaps. Chunks record `first_t`,
`last_t`, `sample_count`, `coordinate_system`, so gaps stay explicit and are never silently filled.

## Constraints and rules
- Timestamps are UTC epoch ms (`bigint`) in DTOs, `timestamptz` in tables.
- Raw provider coordinates are stored as received; unit conversion happens via
  `circuit_geometry.unit_meters`, a verified value, never a code constant.
- No synthetic rows. Missing data is missing (and surfaces as `stale` in frames).
- Migrations (Flyway) arrive with the Postgres driver in Phase 2.

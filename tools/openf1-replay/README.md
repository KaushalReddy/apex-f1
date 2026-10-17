# Race replay datasets (Race Replay, `/replay`)

`apps/web/public/replay/<year>/<sessionKey>.json` (schema `apex-f1/race-replay@1`, validated by `apps/web/src/lib/replay/dataset.ts`)
and `<year>/index.json` are **generated** by `export.mjs` from [OpenF1](https://openf1.org) and served by the site; the browser
loads one race at a time. The app never calls OpenF1.

```
node tools/openf1-replay/export.mjs --year 2026 --out apps/web/public/replay/2026 [--sessions 11388,11731]
```
About 100 requests per race (positions in 30-minute windows per car), spaced 2.1 s apart for OpenF1's free tier, with retries on
429/5xx and dropped connections (`tools/openf1-client.mjs`); responses are cached in `.cache/` (gitignored). Roughly 4 minutes and
2 MB (about 0.8 MB gzipped) per race. Races without published laps are skipped.

## Contents (recorded source data)
| Field | OpenF1 endpoint | Resolution / note |
|---|---|---|
| Car positions | `/location` | ~3.7 Hz recorded; **thinned to samples ≥ 1 s apart** (dropped, never synthesised), (0,0,0) "no fix" rows removed, delta-encoded |
| Running order | `/position` | every official order change, timestamped |
| Gaps | `/intervals` | gap to leader and interval, ~4 s cadence; "+n LAP(S)" kept as laps down |
| Laps | `/laps` | lap start, lap time and sector times per driver |
| Pit stops | `/pit` | time, lap, pit-lane and stationary time |
| Race control | `/race_control` | every message, timestamped |
| Tyre stints | `/stints` | stint number, compound, first and last lap, tyre age at the start |
| On-track passes | `/overtakes` | time, overtaking car, overtaken car, position gained |
Times are ms from the replay start (`startUtc`): 20 s before lights out (first lap start) to 30 s after the last lap ends.

## What the app derives (tested in `apps/web/src/lib/replay`)
- Positions are projected onto the circuit centerline (same as the 3D track). Between two samples ≤ 5 s apart a car moves forward
  along the centerline in proportion to time; wider gaps are **not bridged** (the car holds its last position, marked stale).
- Running order, gaps, lap times, pit state are the latest **published** values at the replay time (never the final classification).
- Events: official race-control moments (start, Safety Car/VSC periods, red flag, chequered flag), published pit stops, and position
  changes from the timing feed (labelled as such: they include pit cycles, so they are not called overtakes).
- Replays need a generated circuit layout; races at circuits without one (Sepang) are listed but not playable.

## Two-driver comparison (Race Replay → Compare; `apps/web/src/lib/replay/compare.ts`, tested)
- **Race time** (both drivers at the replay's moment). Official: position, lap, previous and best lap, previous lap's sector times,
  gap to the leader. Calculated (and labelled): the gap between the two (difference of their published gaps to the leader; laps
  only when one is lapped), time on the current lap, lap progress (recorded position), swaps in the official order between them.
- **Lap comparison** (two complete laps, any lap numbers, aligned by distance; never shown as simultaneous). Official lap and sector
  times; a calculated delta trace from recorded positions about 1 s apart. A lap with a position gap over 5 s is not aligned.
- **Telemetry:** only each driver's fastest lap has car data (Telemetry Lab export), so the comparison links there; no telemetry is
  synced to replay time because the replay export holds none.

## Telemetry analysis in the replay (extension of Phases 10–11)
- **Laps tab:** official lap times of both drivers by lap; pit in/out laps (published pit lap and the next), laps overlapping Safety
  Car / VSC / red-flag periods (race control) and lap 1 are flagged and left out of the chart and the consistency figure
  (mean ± sample standard deviation of the remaining laps, at least 3). `apps/web/src/lib/replay/laps.ts`.
- **Lap comparison:** official sector times with a running total (stops at a missing sector); a distance-aligned delta trace and
  where it grew most (250 m windows). Car telemetry (speed, throttle, brake on/off, gear, RPM; ~4 Hz) exists only for each driver's
  fastest valid lap (Telemetry Lab export, served at `/api/telemetry/<session>`), so its traces appear only for those laps; other laps
  use recorded positions (~1 Hz). Highest speeds are recorded samples, never interpolated values.
- **Sync:** picking a point on a lap chart seeks the replay to when Driver A was there; while the replay is inside A's chosen lap the
  chart cursor follows it. The replay clock is the only source of time.
- Not available: telemetry synced to arbitrary race moments (no full-race car data is exported), DRS (null in 2026).

## Weather & Race Control (Phase 12; `apps/web/src/lib/replay/raceControl.ts`, tested)
- **Weather** (`/weather`): one reading a minute from the track-side station (air and track °C, humidity %, pressure hPa, wind m/s and
  direction, rainfall 0/1), from before the start. A track temperature of exactly 0 °C is treated as missing (isolated sensor dropouts
  between ~45 °C readings in Azerbaijan, Singapore and Kuala Lumpur 2026). Readings older than 5 minutes are not shown as current.
- **Race control messages** are grouped by APEX F1 into key (start, Safety Car/VSC, red flag, chequered flag, penalties, stewards'
  decisions, black-and-white flags), info and routine (blue flags, deleted lap times, pit-lane notices). Text is as published.
- **Track status** is calculated: red flag (until the next start signal, including "SESSION STARTED") > Safety Car > VSC > sector
  yellows > green. Sector flags are set by sector-scoped YELLOW / DOUBLE YELLOW and cleared by CLEAR / GREEN, a track-wide clear or a
  red flag; a flag with no update for 5 minutes is dropped.
- **Sector shading on the circuit is approximate**: OpenF1 gives marshal-sector numbers, not their positions, so sector k of N (N =
  highest sector number seen in that race) is drawn as the k-th equal slice of the lap from the start/finish line.

## Strategy (Phase 13; `apps/web/src/lib/strategy`, tested)
- **Stints** as published. A compound change with no matching published pit stop (pit lap = the stint's previous last lap, the lap
  after, or its first lap) is flagged, not hidden (e.g. three lap-1 changes in Singapore 2026). Missing compounds show as "not published".
- **Degradation** (calculated): least-squares slope of lap time against tyre age over the stint's comparable laps (not lap 1, pit
  in/out, Safety Car / VSC / red-flag laps, nor the stint's first lap), with its standard error and lap count; needs 5 laps. It includes
  fuel burn-off, which cannot be separated, so true tyre wear is somewhat larger.
- **What-if** (SIMULATION, always labelled): moving one stop re-predicts the two stints around it from the driver's own fitted lines; the
  number of stops is unchanged so pit-lane time cancels. Range from slopes ± one standard error. Finishing position assumes everyone else
  unchanged, from each driver's last published gap. Not modelled: traffic, Safety Cars, warm-up, track/fuel changes, rivals reacting.

## Race Rewind (Phase 15; `apps/web/src/lib/replay/rewind.ts`, tested)
- **Changes**: the driver's official position after lights out; changes within 30 s form one step; steps that net to zero are left out.
- **Who swapped**: cars ahead before and behind after the step (or the reverse), from the official order either side.
- **Why** (first match): own pit stop (pit record from 120 s before to 45 s after), the other car's pit stop, a published pass between
  the two (within 60 s), the other car stopping (no further laps), else unexplained. 0-5% of swaps are unexplained across the 2026 races.
  Places moved with no car swapped (a car dropping out of the order) also count as unexplained, so causes add up to the net change.

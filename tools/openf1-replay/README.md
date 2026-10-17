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

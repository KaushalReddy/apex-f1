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
| Laps | `/laps` | lap start and lap time per driver |
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

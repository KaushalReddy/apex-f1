# Lap telemetry snapshots (Telemetry Lab)

`<year>/<sessionKey>.json` (schema `apex-f1/lap-telemetry@1`, validated by `src/lib/telemetry/parse.ts`) and `<year>/index.json`
(`apex-f1/lap-telemetry-index@1`) are **generated**, never hand-edited, by `tools/openf1-telemetry/export.mjs` from
[OpenF1](https://openf1.org). The `/telemetry` page reads them on the server per request; the web app never calls OpenF1.

## Generate or refresh a season
```
node tools/openf1-telemetry/export.mjs --year 2026 --out apps/web/src/data/telemetry/2026
```
- About 45 requests per session, spaced 2.1 s apart (OpenF1's free tier), so a full season of Qualifying and Race sessions takes
  roughly an hour. Responses are cached in `tools/openf1-telemetry/.cache/` (gitignored); an interrupted run resumes.
- `--sessions Qualifying,Race` (default) chooses the session types. Sessions without published laps are skipped and logged.

## What a file contains (source data, as published)
- Per driver: the **fastest timed lap** of the session, excluding pit-out laps and laps whose time race control **deleted**
  (read from `/race_control` messages "CAR n … TIME … DELETED … LAP k", honouring later "REINSTATED" messages). Deleted laps are
  listed in `excluded`.
- For that lap: lap and sector times (`/laps`), car samples at about 4 Hz (speed km/h, throttle %, brake, RPM, gear; `/car_data`)
  and position samples (`/location`), with times in milliseconds from the lap's start, padded 1 s either side.
- Brake is on/off (0/100) in this feed, not pressure. `drs` is not exported: it is null for 2026 cars.

## What the app derives (src/lib/telemetry/analysis.ts, tested)
- Distance: positions projected onto the circuit centerline of `src/data/circuits/<id>.geometry.json` (same reference for both
  drivers). Circuits without a generated layout (Sepang) get time traces only and no map.
- The gap trace (B minus A at each distance, averaged over 35 m) and interpolated values at the cursor.
- **Invalid samples are shown as missing:** throttle/brake outside their range (the feed's placeholder 104) and stretches of 2.5 s
  or more where every channel repeats unchanged while the car moves (a frozen feed). These occur in real 2026 data (e.g. Suzuka
  qualifying, ANT lap 11: 26.9 s). Files keep the raw values.

## Licence
OpenF1 is a community API (data originating from Formula 1 timing), free for non-commercial use; check openf1.org before any
commercial use.

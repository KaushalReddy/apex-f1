# Season results snapshots

Files here are `<year>.json` (schema `apex-f1/season-results@1`, validated by `src/lib/drivers/parse.ts`). They are **generated**, never
hand-edited, by `tools/openf1-results/export.mjs` from [OpenF1](https://openf1.org), and read at build time by the driver pages. The web app
never calls OpenF1 at runtime.

## Generate or refresh a season
```
node tools/openf1-results/export.mjs --year 2026 --out apps/web/src/data/results/2026.json
```
- OpenF1's free tier rate-limits hard; the tool spaces requests about 2 s apart, backs off on 429/5xx and caches responses in
  `tools/openf1-results/.cache/` (gitignored), so an interrupted run resumes. Delete the cache to pick up later corrections by the source.
- A season in progress contains only races whose date has passed **and** that have a published classification. Past race dates without
  one are listed in `skipped` (the snapshot does not say why); round numbers stay in calendar order.
- Then `cd apps/web && npm run build`. Commit the JSON (deterministic apart from `source.fetchedOn`).

## What the file does and does not claim
- **Source data** (as published): race, sprint and qualifying classifications (position, status, points, laps), drivers' and
  constructors' championship standings after each race (`standings`, `teamStandings`), and each driver's identity and team for the sessions. A text position (e.g. qualifying "RT") becomes
  `position: null` with a status (DNF/DSQ/NC). Unidentified car numbers are resolved through the season's identities when unique.
- **Not included:** the starting grid (qualifying position is not the grid), fastest laps, anything before the
  exported seasons. Career totals are therefore not available; the UI says so.
- **Licence:** OpenF1 is a community API (data originating from Formula 1 timing), free for non-commercial use; check openf1.org before any
  commercial use. Driver portraits linked by OpenF1 are not used: their reuse rights are not established.

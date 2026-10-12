# Circuit geometry artifacts

Files here are `<circuit-slug>.geometry.json` and must conform to `packages/contracts/schemas/circuit-geometry.schema.json`.
They are **generated**, never hand-drawn, from OpenF1 location data by `tools/openf1-spike`.

## Generate Monaco from the spike cache (no network)
The spike caches every OpenF1 response in `tools/openf1-spike/.cache/` (gitignored, so it exists only on the machine that ran the
spike). Re-running with the same arguments as `run_matrix.sh` hits that cache, and `--offline` makes network access impossible:
```
cd tools/openf1-spike
pip install -r requirements.txt
python spike.py --year 2024 --circuit "Monte Carlo" --known-length-m 3337 --offline \
  --export-geometry ../../apps/web/src/data/circuits/monaco.geometry.json
```
- If it stops with `CacheMiss`, the cache lacks something the spike needs (sessions, drivers or laps): run once **without** `--offline`.
- A warning about "location windows not in the cache" means OpenF1 answered 404 (empty window; 404s are not cached) or the window was
  never fetched. The count is recorded in the artifact as `derivation.offlineCacheMisses`; if it is non-zero, check
  `usable_clean_laps` in the report and prefer a normal online run.
- `--known-length-m 3337` is the official Monaco lap length [VERIFY]; it only sets `derivation.scale.status`, never `unitMeters`.

Then `cd apps/web && npm run build`; `/circuits/monaco` renders it. Commit the JSON (deterministic, about 50 to 80 KB).

## What the file does and does not claim
- `points` are `[x, y, z]` in the **source** OpenF1 coordinate system (never pre-transformed). `z` is the median of observed car
  elevations per centerline vertex; flat where unknown. Elevation is not validated.
- `unitMeters` is the spike's `--unit-m` value (0.1, an assumption) unless you pass another. `derivation.scale` records whether
  the measured length agreed with the official length (`--known-length-m`); a `caveat` status means the scale must not be
  presented as exact. Monte Carlo is expected to need this caveat.
- `derivation.startFinishAtIndex0` is true because laps are cut at timing-line crossings; the viewer only draws a start/finish
  bar when it is true.
- No pit lane, kerbs or width: the width is `null` (the viewer uses a labelled nominal width).

# OpenF1 location spike

Answers: can OpenF1 `/location` reconstruct a circuit centerline and place cars on it, and for how many circuits?

```bash
pip install -r requirements.txt
python spike.py --year 2024 --circuit Monza --session-name Race --known-length-m 5793
# several circuits (includes Suzuka, which crosses over itself):
./run_matrix.sh
```

Outputs `out/<circuit>-<year>/report.json` and `report.md`. Responses are cached in `.cache/`
so reruns do not hit the API. Historical data needs no credentials. `pytest` runs the algorithm
tests on SYNTHETIC data only (they validate the code, not OpenF1).


## Exporting a geometry artifact (Phase 3)
`python spike.py --year 2024 --circuit "Monte Carlo" --export-geometry ../../apps/web/src/data/circuits/monaco.geometry.json`
writes a `circuit-geometry.schema.json` document next to the usual report: the averaged centerline in source coordinates, a median-z
profile, and `derivation.scale` (`assumed`, `within-tolerance` or `caveat`, from `--known-length-m`). It is deterministic and
diff-friendly. Pass `--known-length-m` (official lap length) so the scale status is meaningful. Tests use synthetic data only.
Add `--offline` to guarantee no network requests (it reads only `.cache/`; a miss is an error, except missing location windows, which are
counted and reported because empty windows are never cached).

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

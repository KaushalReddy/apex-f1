#!/usr/bin/env python3
"""OpenF1 /location spike: fetch one historical session, analyse it, write a report.
Network code lives here; all maths lives in analysis.py. Stdlib + numpy only."""
from __future__ import annotations
import argparse, hashlib, json, sys, time, urllib.error, urllib.request
from urllib.parse import quote
from datetime import datetime, timedelta, timezone
from pathlib import Path
import numpy as np
import analysis as A

BASE = "https://api.openf1.org/v1"
HERE = Path(__file__).parent
CACHE = HERE / ".cache"
OFFLINE = False          # --offline: never touch the network; a cache miss is an error (or, for location windows, a counted gap)
LOCATION_CACHE_MISSES: list[str] = []


class CacheMiss(RuntimeError):
    """A request that would have needed the network while --offline is set."""

# ---------------- fetching ----------------

def get(path: str, query: str = "", retries: int = 5):
    """GET with on-disk cache and 429/5xx backoff. `query` is passed RAW because OpenF1 filters
    use operators in the key (date>=...), which must not be percent-encoded [VERIFY]."""
    url = f"{BASE}/{path}?{quote(query, safe='=&<>:,.-TZ%')}" if query else f"{BASE}/{path}" 
    CACHE.mkdir(exist_ok=True)
    f = CACHE / (hashlib.sha1(url.encode()).hexdigest() + ".json")
    if f.exists():
        return json.loads(f.read_text())
    if OFFLINE:
        raise CacheMiss(f"offline: not in cache: {url}")
    for attempt in range(retries):
        try:
            req = urllib.request.Request(url, headers={"Accept": "application/json", "User-Agent": "apex-f1-spike"})
            with urllib.request.urlopen(req, timeout=60) as r:
                data = json.loads(r.read())
            f.write_text(json.dumps(data))
            time.sleep(0.4)  # be polite: unauthenticated access is rate limited
            return data
        except urllib.error.HTTPError as e:
            if e.code in (429, 500, 502, 503, 504) and attempt < retries - 1:
                time.sleep(2 ** attempt); continue
            raise RuntimeError(f"{e.code} for {url}: {e.read()[:200]!r}") from e
    raise RuntimeError("unreachable")

def ts(s: str) -> float:
    return datetime.fromisoformat(s).timestamp()

def iso(t: float) -> str:
    return datetime.fromtimestamp(t, timezone.utc).strftime("%Y-%m-%dT%H:%M:%S.%f")[:-3] + "Z"

def fetch_location(
    session_key,
    driver,
    t0,
    t1,
    step_s=1800,
):
    """Fetch location data in time chunks.

    OpenF1 returns HTTP 404 when a filtered time window
    contains no rows. Such a window is treated as empty.
    """

    rows = []
    a = t0

    while a < t1:
        b = min(a + step_s, t1)

        try:
            chunk = get(
                "location",
                f"session_key={session_key}"
                f"&driver_number={driver}"
                f"&date>={iso(a)}"
                f"&date<{iso(b)}",
            )
            rows += chunk

        except CacheMiss as e:
            # Empty windows (HTTP 404) are not cached by get(), so offline we cannot tell "empty" from "never fetched".
            # Treat as no rows, but count it and surface it; the lap-gap checks then decide whether laps are still usable.
            LOCATION_CACHE_MISSES.append(str(e))
        except RuntimeError as e:
            if str(e).startswith("404 "):
                pass
            else:
                raise

        a = b

    return rows

def collect(year, circuit, session_name, n_drivers):
    s = get("sessions", f"year={year}&circuit_short_name={circuit}&session_name={session_name}")
    if not s:
        sys.exit(f"No session for {year} {circuit} {session_name}")
    s = s[0]; key = s["session_key"]
    t0, t1 = ts(s["date_start"]), ts(s["date_end"])
    drivers = get("drivers", f"session_key={key}")[:n_drivers]
    data, laps = {}, {}
    for d in drivers:
        n = d["driver_number"]
        rows = fetch_location(key, n, t0, t1)
        if not rows:
            continue
        try:
            lap_rows = get("laps", f"session_key={key}&driver_number={n}")
        except RuntimeError as e:
            if not str(e).startswith("404 "):
                raise
            continue  # OpenF1 answers 404 when a driver has no laps in the session (e.g. did not start): skip that driver
        data[n] = tuple(np.array(c, float) for c in zip(*[(ts(r["date"]), r["x"], r["y"], r["z"]) for r in rows]))
        laps[n] = [(l["lap_number"], ts(l["date_start"]), l["lap_duration"], bool(l.get("is_pit_out_lap")))
                   for l in lap_rows if l.get("date_start") and l.get("lap_duration")]
    return s, data, laps

# ---------------- analysis orchestration ----------------

def clean_laps(laps, k=3):
    """Pick the k fastest representative laps: skip lap 1, pit-out laps, and anything >3% off the best."""
    ok = [l for l in laps if l[0] > 1 and not l[3]]
    if not ok:
        return []
    best = min(l[2] for l in ok)
    return sorted([l for l in ok if l[2] <= best * 1.03], key=lambda l: l[2])[:k]

def analyse(data, laps, known_length_m=None, unit_m=0.1, sigma_m=6.0, target_step_m=2.0, export=None):
    rep = {"assumed_unit_m": unit_m, "drivers": {}}
    cleaned, ts_by = {}, {}
    for n, (t, x, y, z) in data.items():
        t, x, y, z, zeros = A.clean_samples(t, x, y, z)
        cleaned[n] = (t, x, y, z); ts_by[n] = t
        sp = np.hypot(np.diff(x), np.diff(y))
        rep["drivers"][n] = {"sampling": A.sampling_stats(t), "zero_zero_zero_rows": zeros,
                             "x_range": [float(x.min()), float(x.max())], "y_range": [float(y.min()), float(y.max())],
                             "z_range": [float(z.min()), float(z.max())],
                             "step_between_samples_units": A.pct(sp, (50, 95, 99, 100))}
    rep["clock_alignment"] = A.clock_alignment(ts_by)

    loops_by = {}
    for n, (t, x, y, z) in cleaned.items():
        ll = clean_laps(laps.get(n, []))
        prelim = [A.lap_to_loop(t, x, y, a, a + dur, 1000) for _, a, dur, _ in ll]
        loops_by[n] = [(lap, a, dur, p) for (lap, a, dur, _), p in zip(ll, prelim) if p is not None]
    usable = {n: v for n, v in loops_by.items() if v}
    rep["usable_clean_laps"] = {n: [v[0] for v in vs] for n, vs in usable.items()}
    if not usable:
        rep["verdict"] = "FAIL: no clean laps with continuous location data"; return rep

    first = next(iter(usable.values()))[0][3]
    est_len_u = A.loop_length(first)
    N = int(max(500, est_len_u * unit_m / target_step_m)); step_u = est_len_u / N
    sigma_pts = sigma_m / unit_m / step_u
    def loops_of(n):
        t, x, y, z = cleaned[n]
        return [A.lap_to_loop(t, x, y, a, a + dur, N) for _, a, dur, _ in usable[n]]
    all_loops = [lp for n in usable for lp in loops_of(n)]
    center, disp = A.build_centerline(all_loops, sigma_pts)
    L = A.loop_length(center)
    rep["centerline"] = {"points": N, "resample_step_m": round(step_u * unit_m, 2), "sigma_m": sigma_m,
                         "laps_used": len(all_loops), "length_units": round(L, 1),
                         "length_m_if_unit_assumed": round(L * unit_m, 1),
                         "closure_gap_units": round(float(np.linalg.norm(center[0] - center[-1])), 1),
                         "racing_line_dispersion_units": A.pct(disp, (50, 95, 100))}
    if known_length_m:
        rep["centerline"]["known_length_m"] = known_length_m
        rep["centerline"]["implied_unit_m"] = round(known_length_m / L, 4)
        rep["centerline"]["length_error_pct_with_assumed_unit"] = round(100 * (L * unit_m - known_length_m) / known_length_m, 2)
    rep["smoothing_sweep"] = A.smoothing_sweep(all_loops[0], [0, 1, 2, 3, 5, 8, 12], step_u)
    # leave-one-driver-out consistency: build from one driver, test on another's clean laps
    ids = list(usable)
    if len(ids) >= 2:
        c2, _ = A.build_centerline(loops_of(ids[0]), sigma_pts)
        test = np.vstack(loops_of(ids[1]))
        rep["leave_one_driver_out_lateral_units"] = A.pct(A.project(test, c2)[1])
    # all samples of every driver vs centerline (cars in pit lane/garage will be far)
    off_units = 40 / unit_m
    allres = {}
    for n, (t, x, y, z) in cleaned.items():
        d = A.project(np.stack([x, y], 1)[::2], center)[1]
        allres[n] = {**A.pct(d), "frac_beyond_40m": round(float((d > off_units).mean()), 4)}
    rep["all_samples_lateral_units"] = allres
    rep["self_proximity_points_within_20m"] = A.self_proximity(center, 20 / unit_m)
    # elevation along the centerline
    zs = np.concatenate([cleaned[n][3] for n in usable]); rep["z_total_range_units"] = float(zs.max() - zs.min())
    rep["verdict"] = verdict(rep)
    if export is not None:   # raw material for the geometry artifact; the report itself stays unchanged
        xs, ys, zs_ = [], [], []
        for n, vs in usable.items():
            t, x, y, z = cleaned[n]
            for _, a, dur, _ in vs:
                m = (t >= a) & (t < a + dur)
                xs.append(x[m]); ys.append(y[m]); zs_.append(z[m])
        export.update(center=center, z=A.z_profile(center, np.concatenate(xs), np.concatenate(ys), np.concatenate(zs_)),
                      laps_used=len(all_loops), sigma_m=sigma_m, step_m=step_u * unit_m, unit_m=unit_m,
                      centerline_report=rep["centerline"], verdict=rep["verdict"])
    return rep

def verdict(rep):
    c = rep["centerline"]; issues = []
    if "length_error_pct_with_assumed_unit" in c and abs(c["length_error_pct_with_assumed_unit"]) > 2:
        issues.append(f"length off by {c['length_error_pct_with_assumed_unit']}% under assumed unit")
    lo = rep.get("leave_one_driver_out_lateral_units", {}).get("p95")
    if lo is not None and lo * rep["assumed_unit_m"] > 8:
        issues.append(f"cross-driver p95 lateral {lo*rep['assumed_unit_m']:.1f} m > 8 m")
    if rep["self_proximity_points_within_20m"] > 0:
        issues.append("centerline self-crossing/close approach: needs tracked (windowed) projection")
    return "PASS" if not issues else "PASS WITH CAVEATS: " + "; ".join(issues)

def markdown(s, rep):
    out = [f"# Spike report: {s['circuit_short_name']} {s['year']} {s['session_name']} (session_key {s['session_key']})", "",
           f"**Verdict:** {rep.get('verdict')}", "", "```json", json.dumps(rep, indent=2, default=float), "```"]
    return "\n".join(out)

def main():
    ap = argparse.ArgumentParser()

    ap.add_argument(
        "--year",
        type=int,
        default=2024,
    )

    ap.add_argument(
        "--circuit",
        default="Monza",
    )

    ap.add_argument(
        "--session-name",
        default="Race",
    )

    ap.add_argument(
        "--drivers",
        type=int,
        default=3,
    )

    ap.add_argument(
        "--known-length-m",
        type=float,
    )

    ap.add_argument(
        "--unit-m",
        type=float,
        default=0.1,
        help=(
            "metres per coordinate unit; "
            "0.1 (decimetres) is an ASSUMPTION "
            "to be verified"
        ),
    )

    ap.add_argument(
        "--offline",
        action="store_true",
        help="use only the on-disk cache; make NO network requests (location windows missing from the cache are counted and reported)",
    )

    ap.add_argument(
        "--export-geometry",
        metavar="PATH",
        help="write the circuit-geometry.schema.json artifact (e.g. apps/web/src/data/circuits/monaco.geometry.json)",
    )

    ap.add_argument(
        "--sigma-m",
        type=float,
        default=6.0,
    )

    a = ap.parse_args()
    globals()["OFFLINE"] = a.offline

    s, data, laps = collect(
        a.year,
        a.circuit,
        a.session_name,
        a.drivers,
    )

    exp = {} if a.export_geometry else None

    rep = analyse(
        data,
        laps,
        a.known_length_m,
        a.unit_m,
        a.sigma_m,
        export=exp,
    )

    if a.offline:
        rep["offline_cache_misses"] = len(LOCATION_CACHE_MISSES)
        if LOCATION_CACHE_MISSES:
            print(f"WARNING: {len(LOCATION_CACHE_MISSES)} location window(s) were not in the cache and were treated as empty "
                  f"(either genuinely empty, which OpenF1 answers with 404 and the cache does not store, or never fetched).",
                  file=sys.stderr)

    if exp:
        art = A.geometry_artifact(
            circuit_key=s["circuit_short_name"],
            coordinate_system="openf1-location",
            session_keys=[s["session_key"]],
            **exp,
        )
        if a.offline:
            art["derivation"]["offlineCacheMisses"] = len(LOCATION_CACHE_MISSES)
        dest = Path(a.export_geometry)
        dest.parent.mkdir(parents=True, exist_ok=True)
        dest.write_text(A.dump_geometry(art))
        print(f"geometry artifact written to {dest} ({len(art['points'])} points, scale {art['derivation']['scale']['status']})")
    elif a.export_geometry:
        sys.exit("analysis produced no usable centerline; nothing exported")

    out = (
        HERE
        / "out"
        / f"{a.circuit}-{a.year}"
    )

    out.mkdir(
        parents=True,
        exist_ok=True,
    )

    (out / "report.json").write_text(
        json.dumps(
            rep,
            indent=2,
            default=float,
        )
    )

    (out / "report.md").write_text(
        markdown(
            s,
            rep,
        )
    )

    print(
        markdown(
            s,
            rep,
        )
    )

    print(
        f"\\nwritten to {out}"
    )


if __name__ == "__main__":
    main()

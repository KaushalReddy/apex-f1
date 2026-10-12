"""Tests the ALGORITHM on SYNTHETIC data. This says nothing about real OpenF1 data."""
import numpy as np
import analysis as A
from spike import analyse

UNIT_M = 0.1
def track(theta):  # closed, non-self-intersecting, ~5.8 km if R~9000 units (decimetres)
    r = 9000 * (1 + 0.25 * np.cos(3 * theta) + 0.12 * np.sin(2 * theta))
    return np.stack([r * np.cos(theta), r * np.sin(theta)], axis=1)

def figure_eight(theta):
    return np.stack([9000 * np.sin(theta), 9000 * np.sin(theta) * np.cos(theta)], axis=1)

def simulate(shape, seed, laps=6, lap_s=95.0, hz=3.7, noise_u=8, offset_u=25, clock=0.0, gap=True):
    rng = np.random.default_rng(seed)
    t_all, p_all, lap_list = [], [], []
    t0 = clock
    for lap in range(1, laps + 1):
        dur = lap_s + rng.normal(0, 0.3) + (30 if lap == 3 else 0)   # lap 3 = slow lap
        t = np.arange(t0, t0 + dur, 1 / hz) + rng.uniform(-0.03, 0.03, int(np.ceil(dur * hz)))[: len(np.arange(t0, t0 + dur, 1 / hz))]
        th = 2 * np.pi * (t - t0) / dur
        base = shape(th)
        tang = np.gradient(base, axis=0); nrm = np.stack([-tang[:, 1], tang[:, 0]], 1); nrm /= np.linalg.norm(nrm, axis=1)[:, None]
        p = base + nrm * rng.normal(0, offset_u) + rng.normal(0, noise_u, base.shape)
        if gap and lap == 4:
            keep = ~((t > t0 + 20) & (t < t0 + 24)); t, p = t[keep], p[keep]   # 4 s dropout
        t_all.append(t); p_all.append(p); lap_list.append((lap, t0, dur, lap == 1))
        t0 += dur   # laps are contiguous: no overlap between laps
    t = np.concatenate(t_all); p = np.vstack(p_all)
    z = 100 + 30 * np.sin(t / 50)
    return (t, p[:, 0], p[:, 1], z), lap_list

def run(shape, **kw):
    d1, l1 = simulate(shape, 1, clock=1000.0)
    d2, l2 = simulate(shape, 2, clock=1000.13)       # different sample clock
    L = A.loop_length(shape(np.linspace(0, 2 * np.pi, 20000, endpoint=False)))
    return analyse({1: d1, 2: d2}, {1: l1, 2: l2}, known_length_m=L * UNIT_M), L

def test_recovers_length_and_consistency():
    rep, L = run(track)
    c = rep["centerline"]
    assert abs(c["length_error_pct_with_assumed_unit"]) < 1.0
    assert abs(c["implied_unit_m"] - UNIT_M) < 0.002
    assert rep["leave_one_driver_out_lateral_units"]["p95"] * UNIT_M < 8
    assert rep["self_proximity_points_within_20m"] == 0
    assert rep["verdict"].startswith("PASS")

def test_bad_laps_are_excluded():
    rep, _ = run(track)
    used = [lap for v in rep["usable_clean_laps"].values() for lap in v]
    assert 1 not in used and 3 not in used         # pit-out lap and slow lap rejected
    assert 4 not in used                            # 4 s dropout lap rejected

def test_gap_and_clock_stats_reported():
    d, _ = simulate(track, 1)
    t = A.clean_samples(*[np.asarray(c) for c in (d[0], d[1], d[2], d[3])])[0]
    s = A.sampling_stats(t)
    assert 3.4 < s["hz_median"] < 4.0 and s["gaps_gt_1s"] >= 1

def test_figure_eight_is_flagged():
    rep, _ = run(figure_eight)
    assert rep["self_proximity_points_within_20m"] > 0
    assert "self-crossing" in rep["verdict"]

def test_smoothing_shrinks_but_stays_small():
    d, l = simulate(track, 1)
    t, x, y, z, _ = A.clean_samples(*d)
    loop = A.lap_to_loop(t, x, y, l[1][1], l[1][1] + l[1][2], 2000)
    sw = A.smoothing_sweep(loop, [0, 5, 20], A.loop_length(loop) / 2000)
    assert sw[0]["max_shift_units"] == 0 and sw[1]["roughness"] < sw[0]["roughness"]
    assert abs(sw[1]["length_change_pct"]) < 1.0


# ---------------- geometry artifact export ----------------
import json

def run_export(shape, known_factor=1.0, **kw):
    d1, l1 = simulate(shape, 1, clock=1000.0)
    d2, l2 = simulate(shape, 2, clock=1000.13)
    L = A.loop_length(shape(np.linspace(0, 2 * np.pi, 20000, endpoint=False)))
    exp = {}
    rep = analyse({1: d1, 2: d2}, {1: l1, 2: l2}, known_length_m=None if known_factor is None else L * UNIT_M * known_factor, export=exp, **kw)
    return A.geometry_artifact(circuit_key="SYNTHETIC", coordinate_system="openf1-location", session_keys=[42], **exp), rep

def test_export_shape_and_contract_fields():
    art, _ = run_export(track)
    assert art["closed"] is True and art["widthMeters"] is None
    assert art["circuitKey"] == "SYNTHETIC" and art["coordinateSystem"] == "openf1-location"
    assert len(art["points"]) >= 3 and all(len(p) == 3 for p in art["points"])
    d = art["derivation"]
    assert d["sessionKeys"] == [42] and d["lapsUsed"] > 0 and d["startFinishAtIndex0"] is True
    z = [p[2] for p in art["points"]]
    assert 70 <= min(z) and max(z) <= 130          # simulated z = 100 +/- 30; never invented outside the observed range

def test_export_is_deterministic():
    a, _ = run_export(track)
    b, _ = run_export(track)
    assert json.dumps(a, sort_keys=True) == json.dumps(b, sort_keys=True)

def test_scale_status_is_honest():
    assumed, _ = run_export(track, known_factor=None)
    assert assumed["derivation"]["scale"]["status"] == "assumed"
    ok, _ = run_export(track, known_factor=1.0)
    assert ok["derivation"]["scale"]["status"] == "within-tolerance"
    bad, _ = run_export(track, known_factor=1.10)          # official length 10% longer than measured
    assert bad["derivation"]["scale"]["status"] == "caveat"
    assert bad["unitMeters"] == 0.1                          # the assumed unit is never silently overwritten

def test_export_flags_self_crossing_in_verdict():
    art, _ = run_export(figure_eight)
    assert "self-crossing" in art["derivation"]["spikeVerdict"]

def test_export_conforms_to_the_json_schema():
    jsonschema = __import__("pytest").importorskip("jsonschema")
    schema = json.load(open(__import__("pathlib").Path(__file__).resolve().parents[2] / "packages/contracts/schemas/circuit-geometry.schema.json"))
    art, _ = run_export(track)
    jsonschema.Draft202012Validator(schema).validate(json.loads(json.dumps(art)))

def test_report_is_unchanged_by_exporting():
    rep_plain, _ = run(track)
    _, rep_exp = run_export(track, known_factor=1.0)
    assert rep_plain["centerline"]["laps_used"] == rep_exp["centerline"]["laps_used"]

def test_cli_writes_a_schema_shaped_artifact(tmp_path, monkeypatch):
    """Exercises main() end to end (argument parsing, export, file writing) with the network stubbed out."""
    import spike
    d1, l1 = simulate(track, 1, clock=1000.0)
    d2, l2 = simulate(track, 2, clock=1000.13)
    monkeypatch.setattr(spike, "collect", lambda *a, **k: ({"session_key": 9999, "circuit_short_name": "SYNTHETIC", "year": 2024, "session_name": "Race"}, {1: d1, 2: d2}, {1: l1, 2: l2}))
    monkeypatch.setattr(spike, "HERE", tmp_path)
    out = tmp_path / "nested" / "x.geometry.json"
    monkeypatch.setattr("sys.argv", ["spike.py", "--circuit", "SYNTHETIC", "--export-geometry", str(out)])
    spike.main()
    art = json.loads(out.read_text())
    assert art["circuitKey"] == "SYNTHETIC" and art["derivation"]["sessionKeys"] == [9999]
    assert out.read_text().endswith("\n")

def test_dump_is_stable_parseable_and_one_point_per_line():
    art, _ = run_export(track)
    text = A.dump_geometry(art)
    assert json.loads(text) == json.loads(json.dumps(art))
    assert text == A.dump_geometry(art) and text.endswith("\n")
    assert sum(1 for line in text.splitlines() if line.startswith("  [")) == len(art["points"])


# ---------------- offline mode ----------------

def test_offline_never_touches_the_network_and_reads_the_cache(tmp_path, monkeypatch):
    import spike
    monkeypatch.setattr(spike, "CACHE", tmp_path)
    monkeypatch.setattr(spike, "OFFLINE", True)
    def boom(*a, **k):
        raise AssertionError("network used in offline mode")
    monkeypatch.setattr(spike.urllib.request, "urlopen", boom)
    url = f"{spike.BASE}/laps?session_key=1"
    (tmp_path / (spike.hashlib.sha1(url.encode()).hexdigest() + ".json")).write_text('[{"lap_number": 1}]')
    assert spike.get("laps", "session_key=1") == [{"lap_number": 1}]            # cache hit
    import pytest
    with pytest.raises(spike.CacheMiss):
        spike.get("laps", "session_key=2")                                       # miss -> error, no request

def test_offline_location_misses_are_counted_not_hidden(tmp_path, monkeypatch):
    import spike
    monkeypatch.setattr(spike, "CACHE", tmp_path)
    monkeypatch.setattr(spike, "OFFLINE", True)
    monkeypatch.setattr(spike, "LOCATION_CACHE_MISSES", [])
    monkeypatch.setattr(spike.urllib.request, "urlopen", lambda *a, **k: (_ for _ in ()).throw(AssertionError("network used")))
    rows = spike.fetch_location(1, 44, 1_700_000_000.0, 1_700_000_000.0 + 3600, step_s=1800)
    assert rows == [] and len(spike.LOCATION_CACHE_MISSES) == 2

def test_online_mode_is_unchanged_by_default():
    import spike
    assert spike.OFFLINE is False

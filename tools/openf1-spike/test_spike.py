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

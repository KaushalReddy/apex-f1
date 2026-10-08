"""Pure-numpy analysis for the OpenF1 location spike. No network code here (testable offline)."""
from __future__ import annotations
import numpy as np

# ---------- sampling / quality ----------

def sampling_stats(t: np.ndarray) -> dict:
    """t: sorted epoch seconds for ONE driver."""
    if len(t) < 3:
        return {"n": int(len(t))}
    dt = np.diff(t)
    return {
        "n": int(len(t)),
        "duration_s": float(t[-1] - t[0]),
        "dt_median_s": float(np.median(dt)),
        "hz_median": float(1 / np.median(dt)),
        "dt_p95_s": float(np.percentile(dt, 95)),
        "dt_max_s": float(dt.max()),
        "non_monotonic": int((dt < 0).sum()),
        "duplicates": int((dt == 0).sum()),
        "gaps_gt_1s": int((dt > 1.0).sum()),
        "gaps_gt_5s": int((dt > 5.0).sum()),
        "largest_gaps_s": [round(float(g), 2) for g in np.sort(dt)[-5:][::-1]],
    }

def clean_samples(t, x, y, z):
    """Sort, drop exact duplicate timestamps and (0,0,0) rows (assumed 'no fix' [VERIFY])."""
    o = np.argsort(t, kind="stable")
    t, x, y, z = t[o], x[o], y[o], z[o]
    keep = np.ones(len(t), bool)
    keep[1:] = np.diff(t) > 0
    zero = (x == 0) & (y == 0) & (z == 0)
    keep &= ~zero
    return t[keep], x[keep], y[keep], z[keep], int(zero.sum())

def clock_alignment(ts_by_driver: dict[int, np.ndarray]) -> dict:
    """How far apart are sample clocks between drivers? (decides common-grid interpolation)"""
    keys = sorted(ts_by_driver)
    if len(keys) < 2:
        return {}
    a, b = ts_by_driver[keys[0]], ts_by_driver[keys[1]]
    lo, hi = max(a[0], b[0]), min(a[-1], b[-1])
    probe = a[(a > lo) & (a < hi)][:2000]
    idx = np.clip(np.searchsorted(b, probe), 1, len(b) - 1)
    d = np.minimum(np.abs(b[idx] - probe), np.abs(b[idx - 1] - probe))
    return {"drivers": [keys[0], keys[1]], "nearest_sample_dt_median_s": float(np.median(d)),
            "nearest_sample_dt_max_s": float(d.max())}

# ---------- geometry ----------

def arclength(p: np.ndarray) -> np.ndarray:
    return np.concatenate([[0.0], np.cumsum(np.hypot(*np.diff(p, axis=0).T))])

def resample_closed(p: np.ndarray, n: int) -> np.ndarray:
    """Treat one lap as a closed loop; resample to n points equally spaced by arclength."""
    closed = np.vstack([p, p[:1]])
    s = arclength(closed)
    u = np.linspace(0, s[-1], n, endpoint=False)
    return np.stack([np.interp(u, s, closed[:, 0]), np.interp(u, s, closed[:, 1])], axis=1)

def smooth_periodic(p: np.ndarray, sigma_pts: float) -> np.ndarray:
    if sigma_pts <= 0:
        return p.copy()
    k = int(4 * sigma_pts) + 1
    xs = np.arange(-k, k + 1)
    w = np.exp(-xs ** 2 / (2 * sigma_pts ** 2)); w /= w.sum()
    pad = np.concatenate([p[-k:], p, p[:k]], axis=0)
    return np.stack([np.convolve(pad[:, i], w, mode="valid") for i in range(p.shape[1])], axis=1)

def loop_length(p: np.ndarray) -> float:
    return float(arclength(np.vstack([p, p[:1]]))[-1])

def lap_to_loop(t, x, y, t0, t1, n):
    """Cut samples in [t0,t1) -> closed resampled loop (n,2). Returns None if lap is too gappy."""
    m = (t >= t0) & (t < t1)
    if m.sum() < 50 or np.diff(t[m]).max() > 2.0:
        return None
    return resample_closed(np.stack([x[m], y[m]], axis=1), n)

def build_centerline(loops: list[np.ndarray], sigma_pts: float) -> tuple[np.ndarray, np.ndarray]:
    """Average aligned loops (all start at the start/finish line), then smooth.
    Returns (centerline, per-point std across loops = lateral racing-line dispersion)."""
    ref = loops[0]
    aligned = [ref]
    for lp in loops[1:]:   # fix any start-index offset by best circular shift
        shifts = [np.mean(np.hypot(*(np.roll(lp, -s, axis=0) - ref).T)) for s in range(-30, 31, 2)]
        s = range(-30, 31, 2)[int(np.argmin(shifts))]
        aligned.append(np.roll(lp, -s, axis=0))
    stack = np.stack(aligned)
    mean = stack.mean(0)
    disp = np.sqrt(((stack - mean) ** 2).sum(-1).mean(0))
    return smooth_periodic(mean, sigma_pts), disp

def project(points: np.ndarray, line: np.ndarray, chunk: int = 2000):
    """Nearest centerline vertex for each point. Returns (index, distance)."""
    idx = np.empty(len(points), int); dist = np.empty(len(points))
    for i in range(0, len(points), chunk):
        d = np.linalg.norm(points[i:i + chunk, None, :] - line[None, :, :], axis=2)
        idx[i:i + chunk] = d.argmin(1); dist[i:i + chunk] = d.min(1)
    return idx, dist

def pct(a, qs=(50, 95, 99, 100)):
    return {f"p{q}": round(float(np.percentile(a, q)), 2) for q in qs} if len(a) else {}

def self_proximity(line: np.ndarray, near: float, min_sep_frac: float = 0.05) -> int:
    """Count centerline points that come within `near` of a far-away (in lap distance) point:
    >0 means crossings / close parallel sections where nearest-point projection is ambiguous."""
    n = len(line); count = 0
    for i in range(0, n, 4):
        d = np.linalg.norm(line - line[i], axis=1)
        sep = np.minimum(np.abs(np.arange(n) - i), n - np.abs(np.arange(n) - i))
        count += int(((d < near) & (sep > min_sep_frac * n)).any())
    return count

def smoothing_sweep(loop_raw: np.ndarray, sigmas_pts, step_units: float) -> list[dict]:
    """How much does each smoothing level move the line and change its length?"""
    base_len = loop_length(loop_raw)
    out = []
    for s in sigmas_pts:
        sm = smooth_periodic(loop_raw, s)
        out.append({"sigma_pts": s, "sigma_units": round(s * step_units, 1),
                    "length_change_pct": round(100 * (loop_length(sm) - base_len) / base_len, 3),
                    "max_shift_units": round(float(np.linalg.norm(sm - loop_raw, axis=1).max()), 1),
                    "roughness": round(float(np.abs(np.diff(sm, 2, axis=0)).mean()), 4)})
    return out

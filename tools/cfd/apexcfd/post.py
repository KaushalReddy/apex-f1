"""
Post-processing of SU2 outputs. Every number comes from the solver's files (history.csv, surface_flow.csv, flow.csv) or from a formula
applied to them; nothing is filled in. Convergence is judged by stated rules, separately from whether the process exited cleanly.
"""
import base64
import csv
import math

# Convergence rules (stated, not tuned to results):
STABLE_WINDOW = 200  # final iterations over which force coefficients must be steady
STABLE_REL = 1e-3  # max (max - min) / |mean| of CL and CD over the window
STABLE_ABS = 1e-5  # absolute fallback when a coefficient is near zero
MIN_RESIDUAL_DROP = 3.0  # orders of magnitude every residual equation must fall


def read_csv(path):
    with open(path, newline="") as f:
        rows = list(csv.reader(f))
    head = [h.strip().strip('"') for h in rows[0]]
    out = []
    for r in rows[1:]:
        if len(r) == len(head):
            out.append({h: float(v) for h, v in zip(head, r)})
    return head, out


def assess(history, exit_ok, max_iter):
    """Convergence summary from the history rows (one per iteration)."""
    if not history:
        return {"iterations": 0, "solverExitOk": exit_ok, "converged": False, "reasons": ["no iterations recorded"]}
    n = len(history)
    rms_keys = [k for k in history[0] if k.startswith("rms[")]
    # Drop from each residual's peak: from a uniform start some residuals are tiny at iteration 0 and rise before falling.
    drops = {k: max(r[k] for r in history) - history[-1][k] for k in rms_keys}
    window = history[-min(STABLE_WINDOW, n):]

    def spread(key):
        vals = [r[key] for r in window]
        mean = sum(vals) / len(vals)
        rng = max(vals) - min(vals)
        return rng, (rng / abs(mean) if abs(mean) > 1e-9 else math.inf)

    stability = {}
    for key in ("CL", "CD"):
        rng, rel = spread(key)
        stability[key] = {"range": rng, "relativeRange": rel if math.isfinite(rel) else None, "stable": rel <= STABLE_REL or rng <= STABLE_ABS}
    criterion_met = exit_ok and n < max_iter  # SU2 stops early only when its own Cauchy criterion is met
    min_drop = min(drops.values()) if drops else 0.0
    reasons = []
    if not exit_ok:
        reasons.append("solver did not exit successfully")
    if not all(s["stable"] for s in stability.values()):
        reasons.append(f"force coefficients still changing over the last {len(window)} iterations")
    if min_drop < MIN_RESIDUAL_DROP:
        reasons.append(f"residuals fell only {min_drop:.1f} orders of magnitude (need {MIN_RESIDUAL_DROP:.0f})")
    return {
        "iterations": n,
        "maxIterations": int(max_iter),
        "solverExitOk": exit_ok,
        "terminatedBy": "convergence criterion (Cauchy on CL, CD)" if criterion_met else ("iteration limit" if exit_ok else "error"),
        "residualDropOrders": {k: round(v, 2) for k, v in drops.items()},
        "finalResiduals": {k: round(history[-1][k], 2) for k in rms_keys},
        "forceStability": stability,
        "rules": {"window": STABLE_WINDOW, "relativeRange": STABLE_REL, "minResidualDropOrders": MIN_RESIDUAL_DROP},
        "converged": not reasons,
        "reasons": reasons,
    }


def coefficient_history(history, every=10):
    return [{"iter": int(r["Inner_Iter"]), "CL": r["CL"], "CD": r["CD"]} for i, r in enumerate(history) if i % every == 0 or i == len(history) - 1]


def point_in_polygon(x, y, poly):
    inside = False
    j = len(poly) - 1
    for i in range(len(poly)):
        xi, yi = poly[i]
        xj, yj = poly[j]
        if (yi > y) != (yj > y) and x < (xj - xi) * (y - yi) / (yj - yi + 1e-300) + xi:
            inside = not inside
        j = i
    return inside


def read_vtk(path):
    """SU2 ParaView ASCII output (legacy VTK, unstructured grid): point coordinates and every point-data array, in mesh point order."""
    import numpy as np

    with open(path) as f:
        tok = f.read().split()
    i, pts, fields, n = 0, None, {}, 0
    while i < len(tok):
        t = tok[i]
        if t == "POINTS":
            n = int(tok[i + 1])
            pts = np.array(tok[i + 3 : i + 3 + 3 * n], dtype=float).reshape(n, 3)[:, :2]
            i += 3 + 3 * n
        elif t in ("CELLS", "CELL_TYPES"):
            i += 3 + int(tok[i + 2]) if t == "CELLS" else 2 + int(tok[i + 1])
        elif t == "SCALARS":
            name = tok[i + 1]
            j = i + 4 + (2 if tok[i + 4] == "LOOKUP_TABLE" else 0)
            fields[name] = np.array(tok[j : j + n], dtype=float)
            i = j + n
        elif t == "VECTORS":
            name = tok[i + 1]
            fields[name] = np.array(tok[i + 3 : i + 3 + 3 * n], dtype=float).reshape(n, 3)
            i += 3 + 3 * n
        else:
            i += 1
    return pts, fields


def read_su2_mesh(path):
    """Node coordinates and the node ids on each boundary marker of an SU2 native mesh."""
    coords, markers, cur = [], {}, None
    with open(path) as f:
        lines = f.read().splitlines()
    i = 0
    while i < len(lines):
        line = lines[i].strip()
        if line.startswith("NPOIN="):
            n = int(line.split("=")[1].split()[0])
            coords = [tuple(map(float, lines[i + 1 + k].split()[:2])) for k in range(n)]
            i += n
        elif line.startswith("MARKER_TAG="):
            cur = line.split("=")[1].strip()
            markers[cur] = set()
        elif line.startswith("MARKER_ELEMS=") and cur is not None:
            m = int(line.split("=")[1])
            for k in range(m):
                markers[cur].update(int(x) for x in lines[i + 1 + k].split()[1:])
            i += m
        i += 1
    return coords, {k: sorted(v) for k, v in markers.items()}


def surface(points, fields, coords, markers, outlines):
    """Wall values per element marker, ordered along the element outline. Point order is checked against the mesh before use."""
    out = {}
    for name, poly in outlines.items():
        ids = markers.get(name, [])
        for k in ids[:: max(1, len(ids) // 20)]:
            if abs(points[k][0] - coords[k][0]) > 1e-6 or abs(points[k][1] - coords[k][1]) > 1e-6:
                raise RuntimeError("solver output point order does not match the mesh")

        def along(k):
            x, y = points[k]
            return min(range(len(poly)), key=lambda i: (poly[i][0] - x) ** 2 + (poly[i][1] - y) ** 2)

        ids = sorted(ids, key=along)
        out[name] = {
            "x": [round(float(points[k][0]), 6) for k in ids],
            "y": [round(float(points[k][1]), 6) for k in ids],
            "cp": [round(float(fields["Pressure_Coefficient"][k]), 4) for k in ids],
            "yPlus": [round(float(fields["Y_Plus"][k]), 3) for k in ids] if "Y_Plus" in fields else None,
        }
    return out


def encode(values, scale):
    """Quantised little-endian int16, base64; NaN (no flow: inside a body or outside the mesh) -> -32768."""
    import numpy as np

    a = np.where(np.isfinite(values), np.clip(np.round(values * scale), -32767, 32767), -32768).astype("<i2")
    return base64.b64encode(a.tobytes()).decode()


def field(points, fields, outlines, window, u_inf, shape=(240, 120)):
    """Volume solution sampled onto a regular grid over `window` (solver coordinates) by linear interpolation between mesh points."""
    import numpy as np
    from scipy.interpolate import griddata

    x0, x1, y0, y1 = window
    w, h = x1 - x0, y1 - y0
    keep = (points[:, 0] > x0 - w / 2) & (points[:, 0] < x1 + w / 2) & (points[:, 1] > y0 - h / 2) & (points[:, 1] < y1 + h / 2)
    p = points[keep]
    nx, ny = shape
    gx, gy = np.meshgrid(np.linspace(x0, x1, nx), np.linspace(y0, y1, ny))
    inside = np.zeros(gx.shape, dtype=bool)
    for poly in outlines.values():
        xs, ys = [q[0] for q in poly], [q[1] for q in poly]
        for j in range(ny):
            for i in range(nx):
                if min(xs) <= gx[j, i] <= max(xs) and min(ys) <= gy[j, i] <= max(ys) and point_in_polygon(gx[j, i], gy[j, i], poly):
                    inside[j, i] = True

    def sample(values):
        v = griddata(p, values[keep], (gx, gy), method="linear")
        v[inside] = np.nan
        return v

    u = sample(fields["Velocity"][:, 0]) / u_inf
    v = sample(fields["Velocity"][:, 1]) / u_inf
    cp = sample(fields["Pressure_Coefficient"])
    speed = np.sqrt(u * u + v * v)
    stats = lambda a: {"min": round(float(np.nanmin(a)), 4), "max": round(float(np.nanmax(a)), 4)}
    return {
        "nx": nx,
        "ny": ny,
        "window": [x0, x1, y0, y1],
        "encoding": "int16 little-endian, base64, row-major from (x0, y0); value = int / scale; -32768 = no flow (inside a body)",
        "scale": 1000,
        "fields": {
            "speed": {"unit": "U/U∞", "data": encode(speed, 1000), **stats(speed)},
            "u": {"unit": "u/U∞", "data": encode(u, 1000), **stats(u)},
            "v": {"unit": "v/U∞", "data": encode(v, 1000), **stats(v)},
            "cp": {"unit": "Cp", "data": encode(cp, 1000), **stats(cp)},
        },
    }


def naca0012_tmr(n=200):
    """TMR NACA 0012 definition (closes at x = 1.008930411365, scaled to unit chord), counter-clockwise from the trailing edge."""
    c = 1.008930411365
    pts = []
    for i in range(n + 1):
        x = c * (1 - math.cos(math.pi * i / n)) / 2
        y = 0.594689181 * (0.298222773 * math.sqrt(x) - 0.127125232 * x - 0.357907906 * x**2 + 0.291984971 * x**3 - 0.105174606 * x**4)
        pts.append((x / c, y / c))
    upper = list(reversed(pts))
    lower = [(x, -y) for x, y in pts[1:-1]]
    return upper + lower

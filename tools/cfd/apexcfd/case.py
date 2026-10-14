"""
Case validation. The web app validates first (apps/web/src/lib/cfd/config.ts); this repeats the checks at the process boundary because
the runner must never trust its input file. All quantities are SI. Anything outside these ranges is rejected, not clamped.
"""
import math

SCHEMA = "apex-f1/cfd-case@1"
KINDS = ("benchmark-naca0012", "rear-wing-section")
BENCHMARK_GRIDS = ("113x33", "225x65", "449x129")
WING_MESHES = ("coarse", "medium")


class CaseError(ValueError):
    pass


def _num(d, key, lo, hi):
    v = d.get(key)
    if not isinstance(v, (int, float)) or isinstance(v, bool) or not math.isfinite(v) or not (lo <= v <= hi):
        raise CaseError(f"{key} must be a number in [{lo}, {hi}], got {v!r}")
    return float(v)


def validate(case):
    if not isinstance(case, dict) or case.get("schema") != SCHEMA:
        raise CaseError("unknown case schema")
    kind = case.get("kind")
    if kind not in KINDS:
        raise CaseError(f"unsupported case kind {kind!r}")
    c = case.get("conditions") or {}
    if kind == "benchmark-naca0012":
        _num(c, "mach", 0.05, 0.3)
        _num(c, "reynolds", 1e5, 1e7)
        _num(c, "aoaDeg", -5, 16)
        if case.get("mesh", {}).get("level") not in BENCHMARK_GRIDS:
            raise CaseError("benchmark mesh level must be one of " + ", ".join(BENCHMARK_GRIDS))
    else:
        u = _num(c, "speedMps", 5, 100)
        _num(c, "densityKgM3", 0.9, 1.4)
        _num(c, "viscosityPaS", 1.5e-5, 2.0e-5)
        t = _num(c, "temperatureK", 250, 330)
        # Incompressible model only: reject speeds where Mach > 0.3 at this temperature.
        if u / math.sqrt(1.4 * 287.05 * t) > 0.3:
            raise CaseError("Mach number above 0.3: the incompressible model does not apply")
        if case.get("mesh", {}).get("level") not in WING_MESHES:
            raise CaseError("wing mesh level must be one of " + ", ".join(WING_MESHES))
        els = (case.get("geometry") or {}).get("elements")
        if not isinstance(els, list) or not 1 <= len(els) <= 3:
            raise CaseError("geometry must have 1 to 3 elements")
        for e in els:
            pts = e.get("points")
            if not isinstance(e.get("name"), str) or not e["name"].isidentifier():
                raise CaseError("element names must be identifiers")
            if not isinstance(pts, list) or not 20 <= len(pts) <= 2000:
                raise CaseError("each element needs 20 to 2000 points")
            for p in pts:
                if not (isinstance(p, list) and len(p) == 2 and all(isinstance(x, (int, float)) and math.isfinite(x) and abs(x) < 10 for x in p)):
                    raise CaseError("points must be [x, y] pairs in metres")
            if polygon_area(pts) <= 0:
                raise CaseError(f"element {e['name']} is not a counter-clockwise closed outline")
        r = case.get("reference") or {}
        _num(r, "lengthM", 0.01, 5)
    lim = case.get("limits") or {}
    _num(lim, "maxIter", 100, 20000)
    _num(lim, "timeoutS", 60, 4 * 3600)
    return case


def polygon_area(pts):
    """Signed area (shoelace): positive for counter-clockwise outlines."""
    a = 0.0
    for i in range(len(pts)):
        x1, y1 = pts[i]
        x2, y2 = pts[(i + 1) % len(pts)]
        a += x1 * y2 - x2 * y1
    return a / 2

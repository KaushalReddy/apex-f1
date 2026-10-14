"""
Job runner: python -m apexcfd.run <job-directory>

The job directory holds case.json (written by the web app after validation). The runner validates it again, then moves through
preparing-geometry -> meshing -> solving -> post-processing -> completed, writing status.json at every stage. It runs the SU2 binary
at a fixed path with a generated config file only (no shell, no user text on the command line). A `cancel` file in the job directory
stops the job; a timeout kills the solver. "completed" means the pipeline finished; whether the solution converged is a separate flag.
"""
import json
import math
import os
import shutil
import subprocess
import sys
import time
import traceback
from datetime import datetime, timezone

from . import SOLVER, case as casemod, mesh, post, su2

HERE = os.path.dirname(os.path.abspath(__file__))
LOCAL = os.path.join(HERE, "..", ".local")
SU2_CFD = os.path.join(LOCAL, "su2", "bin", "SU2_CFD")
GRIDS = os.path.join(LOCAL, "grids")
GAMMA, R_AIR = 1.4, 287.05

# NASA TMR 2D NACA 0012 validation case, SA model, CFL3D on the 897x257 grid (n0012clcd_cfl3d_sa.dat); other codes in the same table.
TMR_REFERENCE = {
    "source": "NASA Turbulence Modeling Resource, 2D NACA 0012 validation case, SA model results",
    "url": "https://tmbwg.github.io/turbmodels/naca0012_val_sa.html",
    "grid": "897x257",
    "code": "CFL3D",
    "byAlpha": {0: {"CL": -0.0000069, "CD": 0.0081925}, 10: {"CL": 1.0909147, "CD": 0.0123105}, 15: {"CL": 1.5460981, "CD": 0.0212366}},
    "otherCodesAlpha10": {"FUN3D": [1.0983, 0.01242], "NTS": [1.0891, 0.01243], "JOE": [1.0918, 0.01245], "SUMB": [1.0904, 0.01233], "TURNS": [1.1000, 0.01230]},
}


class Status:
    def __init__(self, jobdir):
        self.path = os.path.join(jobdir, "status.json")
        self.data = {"state": "queued", "stages": [], "progress": None, "message": None}
        if os.path.exists(self.path):
            with open(self.path) as f:
                self.data.update(json.load(f))

    def set(self, state, message=None, **extra):
        now = datetime.now(timezone.utc).isoformat()
        self.data["stages"].append({"state": state, "at": now})
        self.data.update({"state": state, "message": message, "updatedAt": now, **extra})
        self.write()

    def write(self):
        tmp = self.path + ".tmp"
        with open(tmp, "w") as f:
            json.dump(self.data, f)
        os.replace(tmp, self.path)


def mesh_header(path):
    info = {}
    with open(path) as f:
        for line in f:
            for key in ("NDIME", "NELEM", "NPOIN", "NMARK"):
                if line.startswith(key + "="):
                    info[key] = int(line.split("=")[1])
            if len(info) == 4:
                break
    return info


def solve(jobdir, cfg, case, status):
    """Runs SU2; returns (exit_ok, cancelled, timed_out)."""
    log = open(os.path.join(jobdir, "solver.log"), "w")
    proc = subprocess.Popen([SU2_CFD, cfg], cwd=jobdir, stdout=log, stderr=subprocess.STDOUT)
    start = time.time()
    cancelled = timed_out = False
    hist = os.path.join(jobdir, "history.csv")
    while proc.poll() is None:
        time.sleep(1)
        if os.path.exists(os.path.join(jobdir, "cancel")):
            proc.terminate()
            cancelled = True
        elif time.time() - start > case["limits"]["timeoutS"]:
            proc.kill()
            timed_out = True
        if os.path.exists(hist):
            with open(hist) as f:
                iters = max(0, sum(1 for _ in f) - 1)
            status.data["progress"] = {"iterations": iters, "maxIterations": int(case["limits"]["maxIter"]), "elapsedS": round(time.time() - start)}
            status.write()
    proc.wait()
    log.close()
    with open(os.path.join(jobdir, "solver.log")) as f:
        exit_ok = proc.returncode == 0 and "Exit Success" in f.read()
    return exit_ok, cancelled, timed_out


def main(jobdir):
    jobdir = os.path.abspath(jobdir)
    status = Status(jobdir)
    t0 = time.time()
    try:
        status.set("preparing-geometry")
        with open(os.path.join(jobdir, "case.json")) as f:
            case = casemod.validate(json.load(f))
        if not os.access(SU2_CFD, os.X_OK):
            raise RuntimeError("SU2 is not installed (run tools/cfd/setup.sh)")
        bench = case["kind"] == "benchmark-naca0012"
        if bench:
            outlines = {"airfoil": post.naca0012_tmr()}
            grid = f"n0012_{case['mesh']['level'].replace('x', '-')}.su2"
            shutil.copyfile(os.path.join(GRIDS, grid), os.path.join(jobdir, "mesh.su2"))
            status.set("meshing", "using the published TMR grid")
            h = mesh_header(os.path.join(jobdir, "mesh.su2"))
            mesh_info = {"generator": "NASA TMR grid family (SU2 TestCases)", "level": case["mesh"]["level"], "file": grid, "cells": h["NELEM"], "nodes": h["NPOIN"]}
            cfg_text = su2.benchmark(case, "mesh.su2")
        else:
            outlines = {e["name"]: [tuple(p) for p in e["points"]] for e in case["geometry"]["elements"]}
            status.set("meshing")
            mesh_info = mesh.build(case, os.path.join(jobdir, "mesh.su2"))
            if mesh_info["minQualitySICN"] is None or mesh_info["minQualitySICN"] <= 0:
                raise RuntimeError(f"mesh has inverted or degenerate cells (min SICN {mesh_info['minQualitySICN']})")
            cfg_text = su2.wing(case, "mesh.su2", list(outlines))
        with open(os.path.join(jobdir, "case.cfg"), "w") as f:
            f.write(cfg_text)

        status.set("solving")
        exit_ok, cancelled, timed_out = solve(jobdir, "case.cfg", case, status)
        if cancelled:
            status.set("cancelled", "stopped by request")
            return 1
        if timed_out:
            status.set("failed", f"solver exceeded the {int(case['limits']['timeoutS'])} s time limit")
            return 1

        status.set("post-processing")
        _, history = post.read_csv(os.path.join(jobdir, "history.csv"))
        conv = post.assess(history, exit_ok, case["limits"]["maxIter"])
        if not exit_ok:
            status.set("failed", "the solver did not finish successfully (see diagnostics)", convergence=conv)
            return 1
        last = history[-1]
        points, fields = post.read_vtk(os.path.join(jobdir, "flow.vtk"))
        coords, markers = post.read_su2_mesh(os.path.join(jobdir, "mesh.su2"))

        if bench:
            c = case["conditions"]
            # Non-dimensional run: the free-stream speed is read from the computed far field (median speed beyond 400 chords).
            far = [math.hypot(*fields["Velocity"][k][:2]) for k in range(len(points)) if math.hypot(*points[k]) > 400]
            u_inf = sorted(far)[len(far) // 2]
            window = [-0.3, 1.6, -0.55, 0.45]
            derived = {"reynolds": c["reynolds"], "mach": c["mach"]}
            reference = {"lengthM": 1.0, "note": "non-dimensional: unit chord, unit span"}
            forces = None
            ref = TMR_REFERENCE["byAlpha"].get(int(round(c["aoaDeg"])))
            verification = {
                "reference": {k: v for k, v in TMR_REFERENCE.items() if k != "byAlpha"} | {"values": ref, "alphaDeg": c["aoaDeg"]},
                "differences": None if not ref else {
                    "CL": last["CL"] - ref["CL"],
                    "CD": last["CD"] - ref["CD"],
                    "CDRelative": (last["CD"] - ref["CD"]) / ref["CD"],
                    "CLRelative": (last["CL"] - ref["CL"]) / ref["CL"] if abs(ref["CL"]) > 1e-3 else None,
                },
            }
        else:
            c = case["conditions"]
            u_inf = c["speedMps"]
            lref = case["reference"]["lengthM"]
            q = 0.5 * c["densityKgM3"] * u_inf**2
            window = [-0.35 * lref, 1.9 * lref, -0.6 * lref, 0.45 * lref]
            derived = {
                "reynolds": c["densityKgM3"] * u_inf * lref / c["viscosityPaS"],
                "mach": u_inf / math.sqrt(GAMMA * R_AIR * c["temperatureK"]),
                "dynamicPressurePa": q,
            }
            reference = {"lengthM": lref, "areaPerSpanM2": lref * 1.0, "note": "per metre of span"}
            # SU2: lift is the force component normal to the free stream along +y. On this inverted wing, downforce = -lift.
            forces = {"liftNPerM": last["CL"] * q * lref, "dragNPerM": last["CD"] * q * lref, "downforceNPerM": -last["CL"] * q * lref}
            verification = None

        # Per-marker coefficients appear in the history as e.g. "CL(wing_main)".
        per_element = {}
        for k, v in last.items():
            if k.endswith(")") and "(" in k and k.split("(")[0] in ("CL", "CD"):
                per_element.setdefault(k[k.index("(") + 1 : -1], {})[k.split("(")[0]] = v
        surf = post.surface(points, fields, coords, markers, outlines)
        yplus = [y for s in surf.values() for y in (s["yPlus"] or [])]
        result = {
            "schema": "apex-f1/cfd-result@1",
            "caseId": case["id"],
            "cacheKey": case["cacheKey"],
            "kind": case["kind"],
            "label": case.get("label"),
            "createdAt": datetime.now(timezone.utc).isoformat(),
            "durationS": round(time.time() - t0, 1),
            "solver": SOLVER | {"build": "official macOS release (x86_64, run under Rosetta on Apple Silicon), single process"},
            "pipeline": case.get("pipeline"),
            "model": case["model"],
            "conditions": case["conditions"],
            "derived": derived,
            "reference": reference,
            "geometry": {k: v for k, v in (case.get("geometry") or {}).items() if k != "elements"},
            "mesh": mesh_info,
            "convergence": conv,
            "coefficients": {"CL": last["CL"], "CD": last["CD"], "CMz": last.get("CMz")},
            "perElement": per_element or None,
            "forcesPerSpan": forces,
            "yPlus": {"max": max(yplus), "mean": sum(yplus) / len(yplus)} if yplus else None,
            "history": post.coefficient_history(history),
            "surface": surf,
            "field": post.field(points, fields, outlines, window, u_inf),
            "transform": case.get("transform"),
            "verification": verification,
            "status": {"solverCompleted": True, "converged": conv["converged"], "validated": False},
            "limitations": case.get("limitations", []),
        }
        with open(os.path.join(jobdir, "result.json.tmp"), "w") as f:
            json.dump(result, f, separators=(",", ":"))
        os.replace(os.path.join(jobdir, "result.json.tmp"), os.path.join(jobdir, "result.json"))
        status.set("completed", None if conv["converged"] else "finished without meeting the convergence rules", convergence=conv)
        return 0
    except casemod.CaseError as e:
        status.set("failed", f"invalid case: {e}")
        return 2
    except Exception as e:  # noqa: BLE001 - every failure must end as a failed job, never a silent success
        with open(os.path.join(jobdir, "pipeline-error.log"), "w") as f:
            traceback.print_exc(file=f)
        status.set("failed", str(e)[:300])
        return 1


if __name__ == "__main__":
    sys.exit(main(sys.argv[1]))

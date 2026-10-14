"""
Copies completed job results into the web app's public/cfd/ so a deployed site can show them without running a solver:
    python -m apexcfd.publish <apps/web> <job-id> [<job-id> ...]
Only jobs whose status is "completed" and that have a result.json are published; their status flags (converged or not) are kept as-is.
"""
import json
import os
import shutil
import sys


def summary(r):
    return {
        "caseId": r["caseId"], "kind": r["kind"], "label": r.get("label"), "createdAt": r["createdAt"], "conditions": r["conditions"],
        "derived": r["derived"], "coefficients": r["coefficients"], "forcesPerSpan": r["forcesPerSpan"], "status": r["status"],
        "origin": "shipped", "meshLevel": r["mesh"]["level"], "solverVersion": r["solver"]["version"], "pipeline": r.get("pipeline"), "geometry": r["geometry"],
    }


def main(web, ids):
    out = os.path.join(web, "public", "cfd")
    os.makedirs(out, exist_ok=True)
    index_path = os.path.join(out, "index.json")
    index = json.load(open(index_path)) if os.path.exists(index_path) else []
    for job in ids:
        d = os.path.join(web, ".cfd", "jobs", job)
        status = json.load(open(os.path.join(d, "status.json")))
        if status["state"] != "completed" or not os.path.exists(os.path.join(d, "result.json")):
            print(f"skip {job}: {status['state']}")
            continue
        r = json.load(open(os.path.join(d, "result.json")))
        shutil.copyfile(os.path.join(d, "result.json"), os.path.join(out, f"{job}.json"))
        index = [s for s in index if s["caseId"] != job] + [summary(r)]
        print(f"published {job}: {r.get('label')}")
    index.sort(key=lambda s: (s["kind"], s.get("label") or ""))
    with open(index_path, "w") as f:
        json.dump(index, f, indent=1)


if __name__ == "__main__":
    main(sys.argv[1], sys.argv[2:])

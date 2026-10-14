"""
INTEGRATION test: actually runs SU2 (skipped when the toolchain is not installed). It runs the published NASA TMR 113x33 NACA 0012 grid
for 30 iterations through the real pipeline stages and checks that the solver was invoked and produced its output files. It does not
check accuracy (30 iterations are not a converged solution); the benchmark study in public/cfd covers that.
"""
import json
import os
import tempfile
import unittest

from apexcfd import run


@unittest.skipUnless(os.access(run.SU2_CFD, os.X_OK), "SU2 not installed (tools/cfd/setup.sh)")
class SolverSmoke(unittest.TestCase):
    def test_su2_runs_and_the_pipeline_reports_honestly(self):
        with tempfile.TemporaryDirectory() as d:
            case = {"schema": "apex-f1/cfd-case@1", "id": "smoke", "cacheKey": "smoke", "kind": "benchmark-naca0012",
                    "model": {"equations": "RANS", "turbulence": "SA"}, "conditions": {"mach": 0.15, "reynolds": 6e6, "aoaDeg": 10},
                    "mesh": {"level": "113x33"}, "limits": {"maxIter": 100, "timeoutS": 600}}
            with open(os.path.join(d, "case.json"), "w") as f:
                json.dump(case, f)
            self.assertEqual(run.main(d), 0)
            with open(os.path.join(d, "status.json")) as f:
                status = json.load(f)
            with open(os.path.join(d, "result.json")) as f:
                result = json.load(f)
            self.assertEqual([s["state"] for s in status["stages"]], ["preparing-geometry", "meshing", "solving", "post-processing", "completed"])
            self.assertIn("SU2", open(os.path.join(d, "solver.log")).read())
            self.assertTrue(os.path.exists(os.path.join(d, "flow.vtk")))
            self.assertEqual(result["convergence"]["iterations"], 100)
            # 100 iterations cannot meet the convergence rules: the result must say so.
            self.assertFalse(result["status"]["converged"])
            self.assertEqual(result["convergence"]["terminatedBy"], "iteration limit")


if __name__ == "__main__":
    unittest.main()

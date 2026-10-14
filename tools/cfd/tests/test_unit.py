"""
Unit tests on SYNTHETIC inputs (no solver runs here; passing them is not evidence that any simulation ran).
Run: tools/cfd/.local/venv/bin/python -m unittest discover -s tools/cfd/tests -t tools/cfd
"""
import base64
import math
import os
import tempfile
import unittest

from apexcfd import case as casemod, mesh, post, su2


def wing_case(**over):
    pts = [[math.cos(2 * math.pi * i / 40) * 0.3, math.sin(2 * math.pi * i / 40) * 0.05] for i in range(40)]  # counter-clockwise ellipse
    c = {
        "schema": "apex-f1/cfd-case@1",
        "kind": "rear-wing-section",
        "conditions": {"speedMps": 50, "densityKgM3": 1.225, "viscosityPaS": 1.7894e-5, "temperatureK": 288.15},
        "geometry": {"elements": [{"name": "wing_main", "points": pts}]},
        "reference": {"lengthM": 0.56},
        "mesh": {"level": "coarse"},
        "limits": {"maxIter": 4000, "timeoutS": 3600},
    }
    for k, v in over.items():
        c[k] = v
    return c


class CaseValidation(unittest.TestCase):
    def test_accepts_a_valid_case(self):
        self.assertIs(casemod.validate(wing_case())["kind"], "rear-wing-section")

    def test_rejects_physically_invalid_inputs(self):
        bad = [
            {"conditions": {**wing_case()["conditions"], "speedMps": -5}},
            {"conditions": {**wing_case()["conditions"], "densityKgM3": 0}},
            {"conditions": {**wing_case()["conditions"], "speedMps": float("nan")}},
            {"conditions": {**wing_case()["conditions"], "speedMps": 100, "temperatureK": 250}},  # Mach 0.32
            {"mesh": {"level": "huge"}},
            {"limits": {"maxIter": 10, "timeoutS": 3600}},
        ]
        for b in bad:
            with self.assertRaises(casemod.CaseError, msg=str(b)):
                casemod.validate(wing_case(**b))

    def test_rejects_bad_geometry(self):
        cw = wing_case()["geometry"]["elements"][0]["points"][::-1]
        for g in ({"elements": [{"name": "wing_main", "points": cw}]}, {"elements": [{"name": "rm -rf", "points": cw[::-1]}]}, {"elements": []}):
            with self.assertRaises(casemod.CaseError):
                casemod.validate(wing_case(geometry=g))

    def test_unknown_schema_or_kind(self):
        with self.assertRaises(casemod.CaseError):
            casemod.validate(wing_case(schema="x"))
        with self.assertRaises(casemod.CaseError):
            casemod.validate(wing_case(kind="full-car-3d"))


class Convergence(unittest.TestCase):
    def rows(self, n, cl, cd, rms):
        return [{"Inner_Iter": i, "CL": cl(i), "CD": cd(i), "rms[P]": rms(i), "rms[U]": rms(i)} for i in range(n)]

    def test_converged_history(self):
        h = self.rows(800, lambda i: -2.6 + math.exp(-i / 50), lambda i: 0.16 + 0.1 * math.exp(-i / 50), lambda i: -1 - i / 100)
        a = post.assess(h, True, 4000)
        self.assertTrue(a["converged"], a["reasons"])
        self.assertEqual(a["terminatedBy"], "convergence criterion (Cauchy on CL, CD)")
        self.assertAlmostEqual(a["residualDropOrders"]["rms[P]"], 7.99, places=2)

    def test_oscillating_forces_are_not_converged(self):
        h = self.rows(800, lambda i: -2.6 + 0.05 * math.sin(i / 7), lambda i: 0.16, lambda i: -1 - i / 100)
        a = post.assess(h, True, 800)
        self.assertFalse(a["converged"])
        self.assertEqual(a["terminatedBy"], "iteration limit")
        self.assertTrue(any("still changing" in r for r in a["reasons"]))

    def test_small_residual_drop_and_failed_exit(self):
        h = self.rows(400, lambda i: -2.6, lambda i: 0.16, lambda i: -1 - i / 1000)
        self.assertTrue(any("orders of magnitude" in r for r in post.assess(h, True, 4000)["reasons"]))
        failed = post.assess(h, False, 4000)
        self.assertFalse(failed["converged"])
        self.assertIn("solver did not exit successfully", failed["reasons"])
        self.assertFalse(post.assess([], True, 100)["converged"])

    def test_drop_is_measured_from_the_peak(self):
        # From a uniform start a residual can begin tiny, rise, then fall: the drop counts from the peak.
        h = self.rows(300, lambda i: 1.0, lambda i: 0.1, lambda i: -13 if i == 0 else -1 - i / 50)
        self.assertGreater(post.assess(h, True, 4000)["residualDropOrders"]["rms[U]"], 5)


class Formats(unittest.TestCase):
    def test_int16_encoding_round_trip_with_no_flow(self):
        import numpy as np

        raw = base64.b64decode(post.encode(np.array([1.2345, -0.5, np.nan, 40.0]), 1000))
        vals = np.frombuffer(raw, dtype="<i2")
        self.assertEqual(list(vals), [1234, -500, -32768, 32767])  # 40.0 saturates at the int16 limit

    def test_point_in_polygon_and_naca_outline(self):
        sq = [(0, 0), (1, 0), (1, 1), (0, 1)]
        self.assertTrue(post.point_in_polygon(0.5, 0.5, sq))
        self.assertFalse(post.point_in_polygon(1.5, 0.5, sq))
        n = post.naca0012_tmr()
        self.assertGreater(casemod.polygon_area([list(p) for p in n]), 0)
        # A NACA 0012 variant: the TMR coefficients and rescaling to unit chord give about 11.8 % thickness, not exactly 12 %.
        self.assertTrue(0.115 < max(y for _, y in n) * 2 < 0.12)

    def test_reads_legacy_vtk(self):
        text = "# vtk DataFile Version 3.0\nx\nASCII\nDATASET UNSTRUCTURED_GRID\nPOINTS 2 double\n0 0 0 1 2 0\nCELLS 1 3\n2 0 1\nCELL_TYPES 1\n3\nPOINT_DATA 2\nSCALARS Pressure_Coefficient double 1\nLOOKUP_TABLE default\n-1.5 0.25\nVECTORS Velocity double\n1 0 0 2 1 0\n"
        with tempfile.NamedTemporaryFile("w", suffix=".vtk", delete=False) as f:
            f.write(text)
        pts, fields = post.read_vtk(f.name)
        os.unlink(f.name)
        self.assertEqual(pts.tolist(), [[0, 0], [1, 2]])
        self.assertEqual(fields["Pressure_Coefficient"].tolist(), [-1.5, 0.25])
        self.assertEqual(fields["Velocity"][1].tolist(), [2, 1, 0])

    def test_first_cell_height(self):
        # Re = 1.225 * 50 * 0.56 / 1.7894e-5 = 1.917e6; Cf = 0.026 Re^-1/7; u_tau = U sqrt(Cf/2); y = nu / u_tau.
        re = 1.225 * 50 * 0.56 / 1.7894e-5
        expect = (1.7894e-5 / 1.225) / (50 * math.sqrt(0.026 / re ** (1 / 7) / 2))
        self.assertAlmostEqual(mesh.first_cell_height(50, 1.225, 1.7894e-5, 0.56), expect, places=12)
        self.assertLess(mesh.first_cell_height(50, 1.225, 1.7894e-5, 0.56), 2e-5)

    def test_solver_config_carries_only_validated_values(self):
        c = casemod.validate(wing_case())
        cfg = su2.wing(c, "mesh.su2", ["wing_main"])
        self.assertIn("SOLVER= INC_RANS", cfg)
        self.assertIn("KIND_TURB_MODEL= SA", cfg)
        self.assertIn("INC_VELOCITY_INIT= ( 50, 0.0, 0.0 )", cfg)
        self.assertIn("MARKER_HEATFLUX= ( wing_main, 0.0 )", cfg)
        self.assertIn("REF_LENGTH= 0.56", cfg)


if __name__ == "__main__":
    unittest.main()

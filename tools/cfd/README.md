# APEX F1 CFD pipeline (SU2)

Real computational fluid dynamics for the Car Lab: a validated case is meshed, solved by **SU2** (open-source finite-volume
RANS solver), checked for convergence and post-processed into a result the web app displays. The browser never computes flow.

## Feasibility (assessed before implementation)

| Area | Finding |
|---|---|
| Existing aerodynamics | `lib/car/airflow.ts` (streamlines through a hand-built potential-flow field), `lib/car/pressure.ts` (illustrative surface colours) and `lib/car/lab.ts` (relative downforce/drag indices) are **visualisations and a simplified model**. None of them solves the flow equations. They stay labelled as such. |
| Solver | Neither SU2 nor OpenFOAM was installed; no Docker. SU2 v8.5.0 publishes an official macOS build (x86_64, runs under Rosetta); OpenFOAM on macOS needs Docker or a separate app build. **SU2 was chosen**: native binary, a native 2D/3D mesh format that gmsh writes directly, incompressible and compressible RANS with Spalart-Allmaras and SST, and an official test-case repository with the NASA TMR grids. |
| Machine | Apple Silicon, 8 cores, **8 GB memory**, about 16 GB free disk; the SU2 build is single-process. |
| Full-car 3D CFD | **Not feasible here.** The procedural car is built from many separate meshes (lofted shells, extruded plates, tubes, boxes) that overlap and are not joined into one watertight surface, so no volume mesh can be built around them without a geometry-repair (boolean union) step. A credible steady RANS run of a full car needs tens of millions of cells and far more memory and time than this machine has. |
| What is feasible | 2D RANS of (a) the published NASA TMR NACA 0012 case, for verification, and (b) a 2D section of the procedural rear wing, generated from the same functions that draw it, at the Lab's wing angles. |

## Install

```
bash tools/cfd/setup.sh   # SU2 v8.5.0, gmsh 4.15.2, numpy, scipy and the TMR grids into tools/cfd/.local (checksum-pinned, gitignored)
```

The web app runs jobs only when started with `APEX_CFD_RUNNER=1` and the toolchain is present; otherwise it shows stored results
(`apps/web/public/cfd`) and says that the solver is not available.

## Cases

### NACA 0012 benchmark (verification)
NASA Turbulence Modeling Resource 2D validation case: M = 0.15, Re = 6 × 10⁶ per chord, α = 10°, compressible RANS with the SA model,
characteristic far field about 500 chords away, adiabatic no-slip wall. Grids: the TMR family 113×33, 225×65 and 449×129 (from
SU2 TestCases). Solver settings follow SU2's own `TestCases/rans/naca0012/turb_NACA0012_sa.cfg`. Reference: CFL3D on 897×257,
C_L = 1.0909, C_D = 0.01231, with five other codes within about 1 % ([source](https://tmbwg.github.io/turbmodels/naca0012_val_sa.html)).
This is code-to-code verification of the pipeline, not experimental validation.

### Rear-wing section
* **Geometry**: the main plane and flap at z = 0.44 m, from `rearWingElements` and `sectionOutline` in `lib/car/geometry.ts` (the
  functions that draw the 3D wing), sampled at 120 points per surface instead of the 12 the drawing uses. A test checks that at
  drawing resolution the section points are the mesh vertices. Simplified: a 2D section of a procedural shape, not any team's wing.
* **Governing equations**: steady incompressible RANS, ∇·u = 0 and ρ(u·∇)u = −∇p + ∇·[(μ + μ_t)(∇u + ∇uᵀ)], constant ρ and μ;
  μ_t from SU2's Spalart-Allmaras model (free-stream ν̃/ν = 3, SU2 default), fully turbulent.
* **Why incompressible**: the Lab's speeds are at most 100 m/s; cases above Mach 0.3 are rejected.
* **Conditions (defaults)**: U∞ = 50 m/s, ISA sea level (ρ = 1.225 kg/m³, T = 288.15 K, μ = 1.7894 × 10⁻⁵ Pa·s).
* **Boundaries**: no-slip adiabatic walls on both elements; far field on a circle of radius 25 reference chords. No ground (the wing is
  0.8 m up), no car body, wheels or beam wing, nothing rotating. Infinite span: no endplates or tip vortices.
* **Reference quantities**: c_ref = 0.33 + 0.23 = 0.56 m (sum of element chords); A_ref = c_ref × 1 m (per metre of span).
* **Mesh**: gmsh, quad boundary layer (first height from a flat-plate estimate for y+ ≈ 1; the solver's y+ is reported), triangles
  elsewhere, refined wake box. Levels "coarse" and "medium" (half the surface and wake sizes, more layers). Inverted cells fail the job.

### Coefficients and signs
SU2 integrates F = ∫(−p n + τ·n) dS over the walls. Lift is the component normal to the free stream along +y; on the inverted
wing it is negative, and **downforce = −lift**, C_DF = −C_L. Drag is along the free stream. C = F / (½ ρ U∞² A_ref);
Cp = (p − p∞) / (½ ρ U∞²); Re = ρ U∞ c_ref / μ. Forces are given per metre of span (N/m).

## Convergence and result status
Rules fixed before any result was computed (`apexcfd/post.py`):
* forces steady: (max − min) / |mean| of C_L and C_D ≤ 10⁻³ over the last 200 iterations;
* every residual at least 3 orders of magnitude below its peak.

SU2 itself stops when a Cauchy criterion on C_L and C_D (10⁻⁶ over 100 iterations) is met, or at the iteration limit.
A result records separately: **solver completed** (exit status and SU2's success message), **converged** (the rules above),
**benchmark comparison** (benchmark only) and **validated** (always false: no experimental comparison has been made).
A diverged or failed run produces no coefficients. A run that completes without meeting the rules is shown as provisional.

## Pipeline
`python -m apexcfd.run <job-dir>`: preparing-geometry → meshing → solving → post-processing → completed (or failed / cancelled),
with `status.json` updated at each stage and solver progress (iterations) while solving. The solver binary is started with a fixed
path and a generated config file only; no shell and no request text on the command line. A `cancel` file stops a job; a timeout
kills it. The web app (`lib/cfd/server.ts`) validates requests, computes a cache key over every physical and numerical input
(including `PIPELINE_VERSION`), returns an identical earlier result instead of re-running, and runs one job at a time.

Outputs: `history.csv` (residuals and coefficients per iteration), `flow.vtk` (all point fields), the SU2 mesh and log. The result
keeps the coefficient history, wall Cp and y+, and the solution sampled onto a regular grid (int16, base64) for display.

## Tests
* `python -m unittest tests.test_unit` (from `tools/cfd`): validation, convergence rules, encodings, VTK parsing, config generation,
  on **synthetic** data. Passing them is not evidence that any simulation ran.
* `python -m unittest tests.test_solver_integration`: runs SU2 for 100 iterations through every pipeline stage (skipped without SU2).
* `apps/web/src/lib/cfd/cfd.test.ts`: request validation, the section/mesh correspondence, coefficient maths, cache keys, job states,
  comparisons, Richardson extrapolation and field decoding.

## Results so far (pipeline apexcfd-3, SU2 8.5.0)

**Verification, NACA 0012, α = 10° (published in `apps/web/public/cfd`)**

| Grid | Cells | C_L | C_D | Converged (rules) |
|---|---|---|---|---|
| 113×33 | 3,584 | 1.0088 | 0.03850 | yes |
| 225×65 | 14,336 | 1.0803 | 0.01838 | yes |
| 449×129 | 57,344 | 1.0961 | 0.01361 | no: forces still settling in the last 200 iterations (SU2's Cauchy test stopped it at 522) |
| Richardson extrapolation (p ≈ 2.2 / 2.1) | | 1.1006 | 0.01213 | |
| NASA TMR, CFL3D 897×257 | | 1.0909 | 0.01231 | |

Finest grid vs CFL3D: C_L +0.5 %, C_D +10.6 %; extrapolated: C_L +0.9 %, C_D −1.5 %, inside the spread of the other published codes
(C_L 1.0891–1.1000, C_D 0.01230–0.01245). The pipeline reproduces published RANS-SA results with the expected second-order grid convergence.

**Rear-wing section, 50 m/s, coarse mesh (about 30,000 cells)**

| Setup (main / flap) | C_L | C_D | Downforce per metre of span | Converged (rules) |
|---|---|---|---|---|
| Balanced (9° / 30°) | −2.617 | 0.155 | 2,244 N/m | no: turbulence residual fell 1.3 orders from its peak |
| Low drag (4° / 14°) | −1.786 | 0.051 | 1,529 N/m | no: forces still changing and residuals fell 2.1 orders at the 4,000-iteration limit |
| High downforce (14° / 44°) | — | — | — | failed at meshing: gmsh "Edge not recovered" (the boundary layers of the main plane and the steep flap meet in the slot) |

Both completed wing runs are provisional, so the Lab does not compare them (comparisons require converged results). Medium-mesh runs
of the balanced and low-drag setups are the next step; the high-downforce case needs the boundary-layer thickness capped by the slot
gap before it can be meshed (a pipeline change, which will need a new pipeline version).

## Publishing results
`python -m apexcfd.publish apps/web <job-id> ...` copies completed results into `apps/web/public/cfd` with an index.

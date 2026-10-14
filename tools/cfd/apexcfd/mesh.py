"""
2D external-flow mesh for a wing section (gmsh -> SU2 native format). Domain: a circle of radius 25 reference chords around the section.
Boundaries: one no-slip wall marker per element, "farfield" on the circle. Near-wall: quad boundary-layer cells whose first height targets
y+ ~ 1 (flat-plate estimate below); the solver's reported y+ is checked afterwards. Elsewhere: triangles graded from the surface outwards,
with a refined box over the wake.
"""
import math

LEVELS = {
    # first-cell targets and sizes in reference chords; "medium" halves the surface and wake sizes of "coarse".
    "coarse": {"surface": 1 / 120, "wake": 1 / 25, "layers": 22, "growth": 1.25},
    "medium": {"surface": 1 / 240, "wake": 1 / 50, "layers": 28, "growth": 1.2},
}


def first_cell_height(speed, density, viscosity, length, yplus=1.0):
    """Flat-plate estimate: Cf = 0.026 Re^-1/7 (Schlichting-type correlation), u_tau = U sqrt(Cf/2), y = y+ nu / u_tau."""
    re = density * speed * length / viscosity
    cf = 0.026 / re ** (1 / 7)
    u_tau = speed * math.sqrt(cf / 2)
    return yplus * (viscosity / density) / u_tau


def build(case, out_path):
    import gmsh  # imported lazily: validation and tests do not need the mesher

    lvl = LEVELS[case["mesh"]["level"]]
    c = case["reference"]["lengthM"]
    cond = case["conditions"]
    h1 = first_cell_height(cond["speedMps"], cond["densityKgM3"], cond["viscosityPaS"], c)
    bl_thickness = h1 * (lvl["growth"] ** lvl["layers"] - 1) / (lvl["growth"] - 1)
    h_surf = lvl["surface"] * c
    radius = 25 * c

    gmsh.initialize(["-nt", "1"])
    gmsh.option.setNumber("General.Terminal", 0)
    try:
        gmsh.model.add("section")
        geo = gmsh.model.geo
        walls, loops, te_points = {}, [], []
        for e in case["geometry"]["elements"]:
            pts = [geo.addPoint(x, y, 0, h_surf) for x, y in e["points"]]
            lines = [geo.addLine(pts[i], pts[(i + 1) % len(pts)]) for i in range(len(pts))]
            loops.append(geo.addCurveLoop(lines))
            walls[e["name"]] = lines
            # Trailing-edge corners (largest x of the outline in solver coordinates): boundary-layer fans there avoid gaps.
            xs = [p[0] for p in e["points"]]
            order = sorted(range(len(xs)), key=lambda i: -xs[i])[:2]
            te_points += [pts[i] for i in order]
        cx = 0.5 * c
        centre = geo.addPoint(cx, 0, 0, radius / 8)
        ring = [geo.addPoint(cx + radius * math.cos(a), radius * math.sin(a), 0, radius / 8) for a in (0, math.pi / 2, math.pi, 3 * math.pi / 2)]
        arcs = [geo.addCircleArc(ring[i], centre, ring[(i + 1) % 4]) for i in range(4)]
        far = geo.addCurveLoop(arcs)
        fluid = geo.addPlaneSurface([far] + loops)
        geo.synchronize()

        for name, lines in walls.items():
            gmsh.model.setPhysicalName(1, gmsh.model.addPhysicalGroup(1, lines), name)
        gmsh.model.setPhysicalName(1, gmsh.model.addPhysicalGroup(1, arcs), "farfield")
        gmsh.model.setPhysicalName(2, gmsh.model.addPhysicalGroup(2, [fluid]), "fluid")

        all_walls = [l for lines in walls.values() for l in lines]
        f = gmsh.model.mesh.field
        bl = f.add("BoundaryLayer")
        f.setNumbers(bl, "CurvesList", all_walls)
        f.setNumbers(bl, "FanPointsList", te_points)
        f.setNumber(bl, "Size", h_surf)
        f.setNumber(bl, "SizeFar", h_surf)
        f.setNumber(bl, "hwall_n", h1)
        f.setNumber(bl, "ratio", lvl["growth"])
        f.setNumber(bl, "thickness", bl_thickness)
        f.setNumber(bl, "Quads", 1)
        f.setAsBoundaryLayer(bl)

        dist = f.add("Distance")
        f.setNumbers(dist, "CurvesList", all_walls)
        f.setNumber(dist, "Sampling", 200)
        near = f.add("Threshold")
        f.setNumber(near, "InField", dist)
        f.setNumber(near, "SizeMin", h_surf * 1.5)
        f.setNumber(near, "SizeMax", radius / 10)
        f.setNumber(near, "DistMin", 0.05 * c)
        f.setNumber(near, "DistMax", 8 * c)
        wake = f.add("Box")
        f.setNumber(wake, "VIn", lvl["wake"] * c)
        f.setNumber(wake, "VOut", radius / 10)
        f.setNumber(wake, "XMin", -0.3 * c)
        f.setNumber(wake, "XMax", 3.5 * c)
        f.setNumber(wake, "YMin", -1.2 * c)
        f.setNumber(wake, "YMax", 1.2 * c)
        f.setNumber(wake, "Thickness", 1.0 * c)
        both = f.add("Min")
        f.setNumbers(both, "FieldsList", [near, wake])
        f.setAsBackgroundMesh(both)
        gmsh.option.setNumber("Mesh.MeshSizeExtendFromBoundary", 0)
        gmsh.option.setNumber("Mesh.MeshSizeFromPoints", 1)
        gmsh.option.setNumber("Mesh.Algorithm", 5)

        gmsh.model.mesh.generate(2)

        types, tags, _ = gmsh.model.mesh.getElements(2)
        counts = {gmsh.model.mesh.getElementProperties(t)[0]: len(tg) for t, tg in zip(types, tags)}
        all_tags = [t for tg in tags for t in tg]
        quality = gmsh.model.mesh.getElementQualities(all_tags, "minSICN") if all_tags else []
        nodes = len(gmsh.model.mesh.getNodes()[0])
        gmsh.write(out_path)
        return {
            "generator": f"gmsh {gmsh.__version__}",
            "level": case["mesh"]["level"],
            "cells": int(sum(counts.values())),
            "cellTypes": {k: int(v) for k, v in counts.items()},
            "nodes": int(nodes),
            "minQualitySICN": float(min(quality)) if len(quality) else None,
            "firstCellHeightM": h1,
            "boundaryLayer": {"layers": lvl["layers"], "growth": lvl["growth"], "thicknessM": bl_thickness},
            "surfaceSizeM": h_surf,
            "farfieldRadiusM": radius,
        }
    finally:
        gmsh.finalize()

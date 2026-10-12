import ReactThreeTestRenderer from "@react-three/test-renderer";
import type { BufferGeometry, Mesh } from "three";
import { describe, expect, it } from "vitest";
import { syntheticLoop } from "@/lib/circuit/testing/syntheticLoop";
import { createWorldTransform } from "@/lib/circuit/transform";
import { useCircuitTransform } from "./CircuitFrame";
import { CircuitWorld, useCircuitModel } from "./CircuitWorld";

function World({ geometry, probe }: { geometry: ReturnType<typeof syntheticLoop>; probe?: (t: ReturnType<typeof useCircuitTransform>) => void }) {
  const model = useCircuitModel(geometry);
  return (
    <CircuitWorld geometry={geometry} model={model}>
      {probe && <Probe probe={probe} />}
    </CircuitWorld>
  );
}

function Probe({ probe }: { probe: (t: ReturnType<typeof useCircuitTransform>) => void }) {
  probe(useCircuitTransform());
  return null;
}

function collect(node: { type: string; children: unknown[] }, acc: string[] = []): string[] {
  acc.push(node.type);
  for (const c of node.children as { type: string; children: unknown[] }[]) collect(c, acc);
  return acc;
}

describe("CircuitWorld scene graph (headless R3F)", () => {
  it("builds a small, stable scene: ground, grid, road, edge lines, chequered line, lights", async () => {
    const g = syntheticLoop({ n: 300 });
    const r = await ReactThreeTestRenderer.create(<World geometry={g} />);
    const types = collect(r.scene as never);
    expect(types.filter((t) => t === "Mesh").length).toBe(3); // ground + road + chequered start/finish
    expect(types.filter((t) => t === "LineSegments").length).toBe(1); // both road edges, one draw call
    expect(types).toContain("GridHelper");
    expect(types).toContain("HemisphereLight");
    expect(types).toContain("DirectionalLight");
    expect(types).not.toContain("LineLoop"); // no centerline outline
    const drawables = types.filter((t) => ["Mesh", "LineLoop", "Line", "GridHelper", "LineSegments"].includes(t));
    expect(drawables.length).toBeLessThanOrEqual(5); // ground, grid, road, edges, chequered line // low draw-call budget
    await r.unmount();
  });

  it("road geometry matches the centerline (2 vertices per point, indexed, slope normals) and is as wide as the drawn width", async () => {
    const g = syntheticLoop({ n: 300 });
    const r = await ReactThreeTestRenderer.create(<World geometry={g} />);
    const meshes = r.scene.findAll((n) => n.type === "Mesh" && (n.instance as Mesh).geometry.type === "BufferGeometry");
    const roads = meshes.filter((m) => (m.instance as Mesh).geometry.getAttribute("normal"));
    expect(roads.length).toBe(1);
    const geo: BufferGeometry = (roads[0].instance as Mesh).geometry;
    expect(geo.getAttribute("position").count).toBe(300 * 2);
    expect(geo.getIndex()!.count).toBe(300 * 6);
    // synthetic loop is ~1.8 km across with unknown width: the drawn width is the legibility width, applied consistently
    const p = geo.getAttribute("position");
    const w = Math.hypot(p.getX(0) - p.getX(1), p.getZ(0) - p.getZ(1));
    expect(w).toBeCloseTo(1800 * 0.012, 0);
    await r.unmount();
  });

  it("draws the start/finish bar only when the geometry says index 0 is the timing line", async () => {
    const g = syntheticLoop({ n: 120 });
    g.derivation.startFinishAtIndex0 = false;
    const r = await ReactThreeTestRenderer.create(<World geometry={g} />);
    expect(collect(r.scene as never).filter((t) => t === "Mesh").length).toBe(2); // ground + road only; no chequered line
    await r.unmount();
  });

  it("exposes the SAME transform to anything rendered inside the scene (Phase 4 contract)", async () => {
    const g = syntheticLoop({ n: 200 });
    let seen: ReturnType<typeof useCircuitTransform> | undefined;
    const r = await ReactThreeTestRenderer.create(<World geometry={g} probe={(t) => (seen = t)} />);
    expect(seen).toBeDefined();
    const expected = createWorldTransform(g);
    const p = g.points[77];
    expect(seen!.toWorld(p[0], p[1], p[2])).toEqual(expected.toWorld(p[0], p[1], p[2]));
    await r.unmount();
  });

  it("throws a clear error when a car layer is rendered outside a circuit", async () => {
    await expect(ReactThreeTestRenderer.create(<Probe probe={() => undefined} />)).rejects.toThrow(/inside <CircuitScene>/);
  });
});

import ReactThreeTestRenderer from "@react-three/test-renderer";
import type { Group, Mesh, Object3D } from "three";
import { describe, expect, it } from "vitest";
import { COMPONENTS, PARTS } from "@/lib/car/components";
import { buildCarGeometry } from "@/lib/car/geometry";
import { setupProfile } from "@/lib/car/setup";
import { NEUTRAL_LIVERY } from "@/lib/car/teams";
import type { ComponentId } from "@/lib/car/types";
import { CarModel } from "./CarModel";

const geometry = buildCarGeometry(setupProfile("balanced").wings);
const noop = () => {};

function model(props: { exploded?: boolean; selected?: ComponentId | null }) {
  return (
    <CarModel
      geometry={geometry}
      livery={NEUTRAL_LIVERY}
      selected={props.selected ?? null}
      hovered={null}
      exploded={props.exploded ?? false}
      reducedMotion={false}
      onSelect={noop}
      onHover={noop}
      labels={false}
    />
  );
}

const groups = (root: Object3D) => {
  const m = new Map<string, Group>();
  root.traverse((o) => {
    if (o.type === "Group" && o.name) m.set(o.name, o as Group);
  });
  return m;
};

describe("CarModel scene graph (headless R3F)", () => {
  it("every part and component in the metadata is a real group with real meshes", async () => {
    const r = await ReactThreeTestRenderer.create(model({}));
    const g = groups(r.scene.instance);
    for (const p of PARTS) {
      const group = g.get(p.key);
      expect(group, p.key).toBeDefined();
      expect(group!.userData.componentId).toBe(p.component);
      let meshes = 0;
      group!.traverse((o) => {
        if ((o as Mesh).isMesh && (o as Mesh).geometry.getAttribute("position").count > 0) meshes++;
      });
      expect(meshes, p.key).toBeGreaterThan(0);
    }
    const ids = new Set([...g.values()].map((x) => x.userData.componentId).filter(Boolean));
    expect([...ids].sort()).toEqual(COMPONENTS.map((c) => c.id).sort());
    await r.unmount();
  });

  it("every mesh belongs to exactly one selectable part (no orphan or mislabelled geometry)", async () => {
    const r = await ReactThreeTestRenderer.create(model({}));
    r.scene.instance.traverse((o) => {
      if (!(o as Mesh).isMesh) return;
      let p: Object3D | null = o;
      const owners: string[] = [];
      while (p) {
        if (p.userData.componentId) owners.push(p.name);
        p = p.parent;
      }
      expect(owners.length).toBe(1);
    });
    await r.unmount();
  });

  it("highlights only the selected component's geometry, reusing its buffers", async () => {
    const r = await ReactThreeTestRenderer.create(model({ selected: "rear-wing" }));
    const overlays: Mesh[] = [];
    r.scene.instance.traverse((o) => {
      if ((o as Mesh).isMesh && o.renderOrder === 2) overlays.push(o as Mesh);
    });
    expect(overlays.length).toBeGreaterThan(0);
    const rearWing = groups(r.scene.instance).get("rear-wing")!;
    for (const m of overlays) {
      let p: Object3D | null = m;
      while (p && !p.userData.componentId) p = p.parent;
      expect(p).toBe(rearWing);
      expect(geometry.assemblies.rearWing.map((x) => x.geometry)).toContain(m.geometry);
    }
    await r.unmount();
  });

  it("explodes and reassembles exactly, repeatedly, without touching base geometry", async () => {
    const r = await ReactThreeTestRenderer.create(model({}));
    const chassis = geometry.assemblies.chassis[0].geometry;
    const before = chassis.getAttribute("position").array.slice(0, 30);
    const wing = () => groups(r.scene.instance).get("front-wing")!.position.x;
    for (let i = 0; i < 3; i++) {
      await r.update(model({ exploded: true }));
      await r.advanceFrames(60, 1 / 30);
      expect(wing()).toBeCloseTo(1, 5);
      await r.update(model({ exploded: false }));
      await r.advanceFrames(60, 1 / 30);
      expect(wing()).toBe(0);
    }
    expect(Array.from(chassis.getAttribute("position").array.slice(0, 30))).toEqual(Array.from(before));
    await r.unmount();
  });
});

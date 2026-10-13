import ReactThreeTestRenderer from "@react-three/test-renderer";
import type { Group, Material, Mesh } from "three";
import { describe, expect, it, vi } from "vitest";
import { CircuitFrameProvider } from "@/components/circuit/CircuitFrame";
import { syntheticLoop } from "@/lib/circuit/testing/syntheticLoop";
import { centerlineToWorld, createWorldTransform } from "@/lib/circuit/transform";
import { SnapshotBuffer } from "@/lib/race/session";
import { createTrackPath } from "@/lib/race/track";
import type { RaceSnapshot } from "@/lib/race/types";
import { DriverLayer, type MarkerDriver } from "./DriverLayer";

const geometry = syntheticLoop({ n: 300 });
const transform = createWorldTransform(geometry);
const path = createTrackPath(centerlineToWorld(geometry, transform));

const snapshot = (progress: Record<string, number | null>): RaceSnapshot => ({
  mode: "DEMO",
  source: { name: "test", status: "ok" },
  session: { id: "s", type: "Race", status: "running", circuitSlug: "t", circuitName: "T", lap: 1, totalLaps: 3 },
  drivers: Object.entries(progress).map(([id, p], i) => ({
    id, code: id.toUpperCase(), name: null, number: i + 1, teamSlug: null, position: i + 1, lap: 1, progress: p, lastLapMs: null, bestLapMs: null,
    gapToLeaderS: null, gapAheadS: null, lapsDown: 0, pit: "none", finished: false, sampleT: 0, stale: false,
  })),
  ordered: true,
  t: 0,
  elapsed: 0,
  epoch: 0,
});

function Layer({ drivers, buffer }: { drivers: MarkerDriver[]; buffer: SnapshotBuffer }) {
  return (
    <CircuitFrameProvider value={transform}>
      <DriverLayer
        geometry={geometry}
        drivers={drivers}
        buffer={{ current: buffer }}
        labels={{ current: null }}
        showLabels
        selected="b"
        focus={[]}
        follow={false}
        animating={false}
        onSelect={() => {}}
        onHover={() => {}}
      />
    </CircuitFrameProvider>
  );
}

describe("DriverLayer (headless R3F)", () => {
  const drivers: MarkerDriver[] = [
    { id: "a", color: "#ff8000", position: 1, stale: false },
    { id: "b", color: "#ff8000", position: 2, stale: false },
    { id: "c", color: "#27f4d2", position: 3, stale: false },
  ];

  it("places each marker on the circuit's own centerline at its progress, and hides cars without a position", async () => {
    vi.spyOn(performance, "now").mockReturnValue(10_000);
    const buffer = new SnapshotBuffer(250);
    buffer.push(snapshot({ a: 0.1, b: 0.5, c: null }), 0);
    const r = await ReactThreeTestRenderer.create(<Layer drivers={drivers} buffer={buffer} />);
    await r.advanceFrames(1, 1 / 60);
    const group = (id: string) => r.scene.findByProps({ name: `driver-${id}` }).instance as Group;
    for (const [id, p] of [["a", 0.1], ["b", 0.5]] as const) {
      const g = group(id);
      const out = [0, 0, 0];
      path.pointAt(p, out);
      expect(g.visible).toBe(true);
      expect(g.position.x).toBeCloseTo(out[0], 3);
      expect(g.position.z).toBeCloseTo(out[2], 3);
      expect(g.position.y).toBeGreaterThan(out[1]); // just above the road surface
    }
    expect(group("c").visible).toBe(false);
    // Selected (b) and leader (a) carry a ring; c does not.
    const meshes = (id: string) => group(id).children.filter((o) => (o as Mesh).isMesh).length;
    expect(meshes("a")).toBe(3);
    expect(meshes("b")).toBe(3);
    expect(meshes("c")).toBe(2);
    vi.restoreAllMocks();
    await r.unmount();
  });

  it("follows interpolated progress through the start/finish line between updates", async () => {
    const now = vi.spyOn(performance, "now");
    const buffer = new SnapshotBuffer(250);
    buffer.push(snapshot({ a: 0.98 }), 0);
    buffer.push(snapshot({ a: 0.02 }), 250);
    now.mockReturnValue(375); // render time 125 ms: halfway between the two updates
    const r = await ReactThreeTestRenderer.create(<Layer drivers={drivers.slice(0, 1)} buffer={buffer} />);
    await r.advanceFrames(1, 1 / 60);
    const g = r.scene.findByProps({ name: "driver-a" }).instance as Group;
    const out = [0, 0, 0];
    path.pointAt(0, out);
    expect(g.position.x).toBeCloseTo(out[0], 1);
    expect(g.position.z).toBeCloseTo(out[2], 1);
    vi.restoreAllMocks();
    await r.unmount();
  });

  it("disposes its materials when unmounted", async () => {
    const buffer = new SnapshotBuffer(250);
    buffer.push(snapshot({ a: 0.2 }), 0);
    const r = await ReactThreeTestRenderer.create(<Layer drivers={drivers.slice(0, 1)} buffer={buffer} />);
    const g = r.scene.findByProps({ name: "driver-a" }).instance as Group;
    const core = (g.children.find((o) => (o as Mesh).isMesh) as Mesh).material as Material;
    const spy = vi.spyOn(core, "dispose");
    await r.unmount();
    expect(spy).toHaveBeenCalled();
  });
});

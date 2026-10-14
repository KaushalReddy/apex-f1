"use client";

import { useEffect, useMemo, useRef } from "react";
import { useFrame } from "@react-three/fiber";
import { BufferAttribute, BufferGeometry, Color, ConeGeometry, CylinderGeometry, LineBasicMaterial, MeshBasicMaterial } from "three";
import { buildStreamlines, pointAtTime, seeds, speedColor, vortices, type FlowSettings, type Streamline } from "@/lib/car/airflow";
import { keepStreamline, keepVortex, type AeroFocus } from "@/lib/car/lab";
import type { Vec3 } from "@/lib/car/types";

/** Data-viz colours shared with the legend (WebGL cannot read CSS variables). */
export const AERO_COLORS = {
  slower: "#4a5a6e",
  free: "#5cb8ff", // viz-1
  faster: "#d9f3ff",
  vortex: "#b78cff", // viz-4
  low: "#2f7bff",
  mid: "#4b5360",
  high: "#ff5a2a",
  downforce: "#3ecf8e", // viz-2
  drag: "#f5b83d", // viz-3
} as const;

export interface AeroLayers {
  streamlines: boolean;
  vortices: boolean;
  forces: boolean;
}

const PER_LINE = 6;
const PER_VORTEX = 12;
const RATE = 2.4; // travel-time units per second (illustrative pace)
const TAIL = 0.11; // trail length in travel-time units
const BG = new Color("#090b0e");
const noRaycast = () => null;

/** Static streamline guides, coloured by relative speed, in one draw call. */
function lineGeometry(lines: Streamline[]) {
  let segs = 0;
  for (const l of lines) segs += Math.max(0, l.speed.length - 1);
  const pos = new Float32Array(segs * 6);
  const col = new Float32Array(segs * 6);
  const c = new Color();
  let o = 0;
  for (const l of lines)
    for (let i = 0; i < l.speed.length - 1; i++)
      for (const j of [i, i + 1]) {
        pos.set(l.points.subarray(j * 3, j * 3 + 3), o);
        speedColor(l.speed[j], l.region, c);
        col.set([c.r, c.g, c.b], o);
        o += 3;
      }
  const g = new BufferGeometry();
  g.setAttribute("position", new BufferAttribute(pos, 3));
  g.setAttribute("color", new BufferAttribute(col, 3));
  return g;
}

/** Comet particles: two vertices each (head, tail). The tail fades into the background colour. */
function Particles({ lines, perLine, playing }: { lines: Streamline[]; perLine: number; playing: boolean }) {
  const { geometry, material, slots } = useMemo(() => {
    const slots: Array<{ line: Streamline; phase: number }> = [];
    lines.forEach((line, li) => {
      const total = line.time[line.time.length - 1] || 1;
      for (let k = 0; k < perLine; k++) slots.push({ line, phase: ((k + ((li * 0.37) % 1)) / perLine) * total });
    });
    const g = new BufferGeometry();
    g.setAttribute("position", new BufferAttribute(new Float32Array(slots.length * 6), 3));
    g.setAttribute("color", new BufferAttribute(new Float32Array(slots.length * 6), 3));
    return { geometry: g, material: new LineBasicMaterial({ vertexColors: true, transparent: true, depthWrite: false }), slots };
  }, [lines, perLine]);
  useEffect(
    () => () => {
      geometry.dispose();
      material.dispose();
    },
    [geometry, material],
  );

  const clock = useRef(0);
  const drawn = useRef<BufferGeometry | null>(null);
  const c = useMemo(() => new Color(), []);
  useFrame((_, dt) => {
    // When paused, still draw once for a new geometry so particles are visible in place.
    if (!playing && drawn.current === geometry) return;
    drawn.current = geometry;
    if (playing) clock.current += Math.min(dt, 1 / 30) * RATE;
    const pos = geometry.getAttribute("position") as BufferAttribute;
    const col = geometry.getAttribute("color") as BufferAttribute;
    const p = pos.array as Float32Array;
    const cl = col.array as Float32Array;
    slots.forEach((s, i) => {
      const t = clock.current + s.phase;
      const speed = pointAtTime(s.line, t, p, i * 6);
      pointAtTime(s.line, t - TAIL, p, i * 6 + 3);
      // Hide the wrap-around segment (tail at the end of the line while the head restarts at the front).
      if (Math.abs(p[i * 6] - p[i * 6 + 3]) > 1) p.copyWithin(i * 6 + 3, i * 6, i * 6 + 3);
      speedColor(speed, s.line.region, c);
      cl.set([c.r, c.g, c.b, BG.r, BG.g, BG.b], i * 6);
    });
    pos.needsUpdate = true;
    col.needsUpdate = true;
  });
  return <lineSegments geometry={geometry} material={material} raycast={noRaycast} frustumCulled={false} />;
}

/**
 * ILLUSTRATIVE airflow (see lib/car/airflow.ts): traced streamlines coloured by relative speed, comet particles that travel at the local
 * speed, wing-tip vortices and conceptual force arrows. Not a fluid simulation. Animation writes buffers in useFrame (no React renders);
 * nothing here is pickable, so the car stays selectable underneath.
 */
export function Airflow({ settings, layers, playing, focus = "overall" }: { settings: FlowSettings; layers: AeroLayers; playing: boolean; focus?: AeroFocus }) {
  const { downforce, drag, lowDragWings } = settings;
  // Streamlines are traced in seed order, so seeds()[i] describes lines[i]; a focus keeps the lines that pass that area.
  const lines = useMemo(() => {
    const all = buildStreamlines({ downforce, drag, lowDragWings });
    const meta = seeds();
    return all.filter((_, i) => keepStreamline(focus, meta[i]));
  }, [downforce, drag, lowDragWings, focus]);
  const vortexLines = useMemo(() => vortices({ downforce, drag, lowDragWings }).filter((_, i) => keepVortex(focus, i)), [downforce, drag, lowDragWings, focus]);
  const guides = useMemo(() => lineGeometry(lines), [lines]);
  const vortexGuides = useMemo(() => lineGeometry(vortexLines), [vortexLines]);
  const guideMat = useMemo(() => new LineBasicMaterial({ vertexColors: true, transparent: true, opacity: 0.32, depthWrite: false }), []);
  useEffect(() => () => guides.dispose(), [guides]);
  useEffect(() => () => vortexGuides.dispose(), [vortexGuides]);
  useEffect(() => () => guideMat.dispose(), [guideMat]);

  return (
    <group name="airflow">
      {layers.streamlines && (
        <>
          <lineSegments geometry={guides} material={guideMat} raycast={noRaycast} />
          <Particles lines={lines} perLine={PER_LINE} playing={playing} />
        </>
      )}
      {layers.vortices && (
        <>
          <lineSegments geometry={vortexGuides} material={guideMat} raycast={noRaycast} />
          <Particles lines={vortexLines} perLine={PER_VORTEX} playing={playing} />
        </>
      )}
      {layers.forces && <ForceArrows settings={settings} />}
    </group>
  );
}

/** Conceptual force arrows. Lengths are relative to the balanced preset and carry no values. */
function ForceArrows({ settings }: { settings: FlowSettings }) {
  const { shaft, head, mats } = useMemo(
    () => ({
      shaft: new CylinderGeometry(0.018, 0.018, 1, 10).translate(0, 0.5, 0),
      head: new ConeGeometry(0.06, 0.14, 16).translate(0, 0.07, 0),
      mats: {
        down: new MeshBasicMaterial({ color: AERO_COLORS.downforce, depthTest: false, transparent: true }),
        drag: new MeshBasicMaterial({ color: AERO_COLORS.drag, depthTest: false, transparent: true }),
      },
    }),
    [],
  );
  useEffect(
    () => () => {
      shaft.dispose();
      head.dispose();
      mats.down.dispose();
      mats.drag.dispose();
    },
    [shaft, head, mats],
  );
  const L = 0.55;
  const wing = settings.lowDragWings ? 0.55 : 1;
  const down = L * settings.downforce;
  const drag = L * settings.drag * (settings.lowDragWings ? 0.75 : 1);
  // Arrow points along local +Y; rotate to aim down (downforce) or rearwards (drag). `tip` is where the arrowhead ends.
  const arrow = (tip: Vec3, length: number, dir: "down" | "rear", key: string) => {
    const tail: Vec3 = dir === "down" ? [tip[0], tip[1] + length, tip[2]] : [tip[0] + length, tip[1], tip[2]];
    const m = mats[dir === "down" ? "down" : "drag"];
    const body = Math.max(length - 0.14, 0.01);
    return (
      <group key={key} position={tail} rotation={dir === "down" ? [Math.PI, 0, 0] : [0, 0, Math.PI / 2]}>
        <mesh geometry={shaft} material={m} scale={[1, body, 1]} renderOrder={4} raycast={noRaycast} />
        <mesh geometry={head} material={m} position={[0, body, 0]} renderOrder={4} raycast={noRaycast} />
      </group>
    );
  };
  return (
    <group name="force-arrows">
      {arrow([2.35, 0.2, 0], down * 0.8 * wing, "down", "fw")}
      {arrow([0, 0.08, 0], down, "down", "floor")}
      {arrow([-2.0, 0.95, 0], down * 0.8 * wing, "down", "rw")}
      {arrow([-2.65, 0.6, 0], drag, "rear", "drag")}
    </group>
  );
}

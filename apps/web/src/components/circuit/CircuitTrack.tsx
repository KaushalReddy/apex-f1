"use client";

import { useEffect, useMemo } from "react";
import { BufferAttribute, BufferGeometry, Color } from "three";
import { buildChecker, buildEdgeLines, buildRoad } from "@/lib/circuit/mesh";
import { CHECKER, PALETTE } from "@/lib/circuit/style";

interface Props {
  /** Centerline in WORLD coordinates (already transformed by the shared circuit transform). */
  centerline: Float32Array;
  closed: boolean;
  /** Drawn road width in metres (see resolveTrackWidth). */
  widthMeters: number;
  /** Draw the chequered start/finish line at vertex 0; only when the geometry says index 0 is the timing line. */
  startFinish: boolean;
}

function geometryFrom(positions: Float32Array, indices: Uint32Array, extra: Record<string, BufferAttribute> = {}): BufferGeometry {
  const g = new BufferGeometry();
  g.setAttribute("position", new BufferAttribute(positions, 3));
  for (const [k, v] of Object.entries(extra)) g.setAttribute(k, v);
  g.setIndex(new BufferAttribute(indices, 1));
  g.computeBoundingSphere();
  return g;
}

/**
 * Road surface (slope-following normals, a gentle height tint), crisp 1 px edge lines and an optional chequered start/finish line.
 * Three draw calls, no textures. The chequered overlay uses polygon offset and no depth writes; the edge lines sit 15 cm above the
 * road, which the distance-scaled clip planes keep clear of z-fighting.
 */
export function CircuitTrack({ centerline, closed, widthMeters, startFinish }: Props) {
  const parts = useMemo(() => {
    const road = buildRoad(centerline, closed, widthMeters);
    const n = road.frames.n;

    // Subtle brightness by height (0.86 .. 1.0) so elevation reads even where the surface is flat-shaded.
    let minY = Infinity, maxY = -Infinity;
    for (let i = 0; i < n; i++) { minY = Math.min(minY, centerline[i * 3 + 1]); maxY = Math.max(maxY, centerline[i * 3 + 1]); }
    const span = Math.max(maxY - minY, 1e-6);
    const base = new Color(PALETTE.asphalt);
    const colors = new Float32Array(n * 2 * 3);
    for (let i = 0; i < n; i++) {
      const k = 0.86 + 0.14 * ((centerline[i * 3 + 1] - minY) / span);
      for (let v = 0; v < 2; v++) colors.set([base.r * k, base.g * k, base.b * k], (i * 2 + v) * 3);
    }
    const roadGeo = geometryFrom(road.positions, road.indices, { normal: new BufferAttribute(road.normals, 3), color: new BufferAttribute(colors, 3) });

    const edge = buildEdgeLines(road.frames);
    const edgeGeo = geometryFrom(edge.positions, edge.indices);

    let checkerGeo: BufferGeometry | null = null;
    if (startFinish) {
      const c = buildChecker(road.frames, 0, CHECKER.rows, CHECKER.cols, 0, widthMeters * CHECKER.depthOfWidth);
      const dark = new Color(PALETTE.checkerDark), light = new Color(PALETTE.checkerLight);
      const cc = new Float32Array(c.shade.length * 3);
      c.shade.forEach((s, i) => cc.set(s ? [light.r, light.g, light.b] : [dark.r, dark.g, dark.b], i * 3));
      checkerGeo = geometryFrom(c.positions, c.indices, { color: new BufferAttribute(cc, 3) });
    }
    return { roadGeo, edgeGeo, checkerGeo };
  }, [centerline, closed, widthMeters, startFinish]);

  useEffect(
    () => () => {
      parts.roadGeo.dispose();
      parts.edgeGeo.dispose();
      parts.checkerGeo?.dispose();
    },
    [parts],
  );

  return (
    <group>
      <mesh geometry={parts.roadGeo} renderOrder={1}>
        <meshStandardMaterial vertexColors roughness={0.93} metalness={0} />
      </mesh>
      <lineSegments geometry={parts.edgeGeo} renderOrder={2}>
        <lineBasicMaterial color={PALETTE.edge} />
      </lineSegments>
      {parts.checkerGeo && (
        <mesh geometry={parts.checkerGeo} renderOrder={3}>
          <meshBasicMaterial vertexColors depthWrite={false} polygonOffset polygonOffsetFactor={-2} polygonOffsetUnits={-8} />
        </mesh>
      )}
    </group>
  );
}

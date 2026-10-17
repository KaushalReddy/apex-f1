"use client";

import { Line } from "@react-three/drei";
import { useMemo } from "react";
import { useCircuitTransform } from "@/components/circuit/CircuitFrame";
import { centerlineToWorld } from "@/lib/circuit/transform";
import type { CircuitGeometry } from "@/lib/circuit/types";
import { createTrackPath } from "@/lib/race/track";

const YELLOW = "#f5b83d"; // warning token
const DOUBLE = "#ff8a5c"; // viz-5: stronger, still distinct from red

/**
 * APPROXIMATE marshal-sector flags on the circuit. OpenF1 publishes the sector number of a yellow flag but not where that sector is, so
 * sector k of N is drawn as the k-th equal slice of the lap from the start/finish line. Real marshal sectors differ in length; the page
 * says so wherever this is shown. Purely visual; drawn just above the road.
 */
export function SectorFlagLayer({ geometry, count, flags }: { geometry: CircuitGeometry; count: number; flags: readonly [number, 1 | 2][] }) {
  const transform = useCircuitTransform();
  const path = useMemo(() => createTrackPath(centerlineToWorld(geometry, transform)), [geometry, transform]);
  const segments = useMemo(
    () =>
      flags.map(([sector, level]) => {
        const from = (sector - 1) / count;
        const to = sector / count;
        const pts: [number, number, number][] = [];
        const out = [0, 0, 0];
        for (let i = 0; i <= 32; i++) {
          path.pointAt(from + ((to - from) * i) / 32, out);
          pts.push([out[0], out[1] + 1.5, out[2]]);
        }
        return { sector, level, pts };
      }),
    [flags, count, path],
  );
  return (
    <group name="sector-flags">
      {segments.map((s) => (
        <Line key={s.sector} points={s.pts} color={s.level === 2 ? DOUBLE : YELLOW} lineWidth={s.level === 2 ? 7 : 5} transparent opacity={0.8} depthTest={false} renderOrder={3} />
      ))}
    </group>
  );
}

/** Virtual Safety Car: the whole circuit outlined in bright yellow (a VSC applies everywhere at once; there is no car to draw). */
export function TrackOutline({ geometry, color = "#ffd60a" }: { geometry: CircuitGeometry; color?: string }) {
  const transform = useCircuitTransform();
  const pts = useMemo(() => {
    const path = createTrackPath(centerlineToWorld(geometry, transform));
    const out: [number, number, number][] = [];
    const p = [0, 0, 0];
    for (let i = 0; i <= 400; i++) {
      path.pointAt(i / 400, p);
      out.push([p[0], p[1] + 1.2, p[2]]);
    }
    return out;
  }, [geometry, transform]);
  return <Line name="vsc-outline" points={pts} color={color} lineWidth={3} transparent opacity={0.75} depthTest={false} renderOrder={2} />;
}

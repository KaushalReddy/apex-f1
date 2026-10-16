"use client";

import { useMemo } from "react";
import CircuitScene from "@/components/circuit/CircuitScene";
import { useCircuitTransform } from "@/components/circuit/CircuitFrame";
import { RaceFit } from "@/components/race/RaceFit";
import { centerlineToWorld } from "@/lib/circuit/transform";
import type { CircuitGeometry } from "@/lib/circuit/types";
import { createTrackPath } from "@/lib/race/track";

export interface CarMarker {
  id: string;
  color: string;
  /** Lap fraction on the centerline, or null to hide the marker. */
  progress: number | null;
}

/** Both cars as discs on the road, sized to the circuit so they read the same on a 3 km and a 7 km layout. */
function Markers({ geometry, cars }: { geometry: CircuitGeometry; cars: CarMarker[] }) {
  const transform = useCircuitTransform();
  const { path, radius } = useMemo(() => {
    const world = centerlineToWorld(geometry, transform);
    let [x0, x1, z0, z1] = [Infinity, -Infinity, Infinity, -Infinity];
    for (let i = 0; i < world.length; i += 3) [x0, x1, z0, z1] = [Math.min(x0, world[i]), Math.max(x1, world[i]), Math.min(z0, world[i + 2]), Math.max(z1, world[i + 2])];
    return { path: createTrackPath(world), radius: Math.max(x1 - x0, z1 - z0) * 0.018 };
  }, [geometry, transform]);
  const at: number[] = [0, 0, 0];
  return (
    <group name="telemetry-cars">
      {cars.map((c) => {
        if (c.progress == null) return null;
        path.pointAt(c.progress, at);
        return (
          <mesh key={c.id} position={[at[0], at[1] + radius * 0.6, at[2]]} renderOrder={5} raycast={() => null}>
            <sphereGeometry args={[radius, 24, 16]} />
            <meshBasicMaterial color={c.color} depthTest={false} />
          </mesh>
        );
      })}
    </group>
  );
}

export default function TelemetryScene({ geometry, cars }: { geometry: CircuitGeometry; cars: CarMarker[] }) {
  return (
    <CircuitScene geometry={geometry} preset={{ name: "overview", nonce: 0 }}>
      <RaceFit geometry={geometry} nonce={0} view="topDown" />
      <Markers geometry={geometry} cars={cars} />
    </CircuitScene>
  );
}

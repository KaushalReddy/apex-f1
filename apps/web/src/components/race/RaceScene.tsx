"use client";

import CircuitScene from "@/components/circuit/CircuitScene";
import type { ViewPreset } from "@/components/circuit/CircuitCamera";
import type { CircuitGeometry } from "@/lib/circuit/types";
import { DriverLayer } from "./DriverLayer";
import type { Insets, RaceView } from "@/lib/race/fit";
import { RaceFit } from "./RaceFit";

type DriverLayerProps = Omit<Parameters<typeof DriverLayer>[0], "geometry">;

/**
 * The race view's 3D scene: the unchanged Phase 3 circuit scene (track, camera fitting, lighting) with the driver layer as its child, so
 * markers live in the circuit's own coordinate frame. Loaded client-side only (three.js needs WebGL).
 */
export default function RaceScene({ geometry, preset, fitNonce, insets, view, ...layer }: { geometry: CircuitGeometry; preset: ViewPreset; fitNonce: number; insets?: Insets; view?: RaceView } & DriverLayerProps) {
  return (
    <CircuitScene geometry={geometry} preset={preset}>
      <RaceFit geometry={geometry} nonce={fitNonce} insets={insets} view={view} />
      <DriverLayer geometry={geometry} {...layer} />
    </CircuitScene>
  );
}

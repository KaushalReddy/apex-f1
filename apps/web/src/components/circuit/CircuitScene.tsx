"use client";

import type { ReactNode } from "react";
import { Canvas } from "@react-three/fiber";
import type { CircuitGeometry } from "@/lib/circuit/types";
import { CircuitCamera, type ViewPreset } from "./CircuitCamera";
import { CircuitWorld, useCircuitModel } from "./CircuitWorld";

interface Props {
  geometry: CircuitGeometry;
  preset: ViewPreset;
  /** Extension point: Phase 4 car layers render here and read the shared frame via useCircuitTransform(). */
  children?: ReactNode;
}

/**
 * Reusable circuit scene. `flat` disables tone mapping so the palette in lib/circuit/style.ts reads as specified. Renders on demand
 * (no animation loop) until something animates; Phase 4 switches frameloop to "always". The camera is fitted by CircuitCamera once the
 * canvas size is known, so the initial camera below is only a placeholder.
 */
export default function CircuitScene({ geometry, preset, children }: Props) {
  const model = useCircuitModel(geometry);
  return (
    <Canvas flat frameloop="demand" dpr={[1, 2]} gl={{ antialias: true }} camera={{ position: [0, 800, 800], fov: 40, near: 1, far: 20000 }}>
      <CircuitWorld geometry={geometry} model={model}>
        <CircuitCamera centerline={model.centerline} marginMeters={model.trackWidth.drawnMeters / 2} preset={preset} />
        {children}
      </CircuitWorld>
    </Canvas>
  );
}

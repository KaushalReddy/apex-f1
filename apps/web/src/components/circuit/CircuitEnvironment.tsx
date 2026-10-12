"use client";

import { LIGHTS, PALETTE } from "@/lib/circuit/style";

interface Props {
  /** Horizontal radius of the circuit in metres; sizes the ground and grid. */
  radius: number;
}

/** A "nice" grid spacing (metres) so a circuit shows roughly 6 to 12 cells across, never a dense mesh. */
export function gridStep(radius: number): number {
  const target = Math.max(radius, 50) / 4;
  const steps = [25, 50, 100, 250, 500, 1000, 2500];
  return steps.find((s) => s >= target) ?? 5000;
}

/**
 * Background, ground, a deliberately faint reference grid and lights. No shadows: the road is flat apart from gentle slopes,
 * which the raking sun reveals through shading. Intensities are physically based (see style.ts): total irradiance near PI shows a
 * dark albedo at about its sRGB value, which is why these numbers are larger than the usual 0..1 defaults.
 */
export function CircuitEnvironment({ radius }: Props) {
  const step = gridStep(radius);
  const size = Math.ceil((radius * 4) / step) * step;
  const az = (LIGHTS.sunAzimuthDeg * Math.PI) / 180;
  const el = (LIGHTS.sunElevationDeg * Math.PI) / 180;
  const d = Math.max(radius, 100) * 2;
  return (
    <>
      <color attach="background" args={[PALETTE.background]} />
      <hemisphereLight args={[LIGHTS.hemisphereSky, LIGHTS.hemisphereGround, LIGHTS.hemisphereIntensity]} />
      <directionalLight position={[Math.cos(az) * Math.cos(el) * d, Math.sin(el) * d, Math.sin(az) * Math.cos(el) * d]} intensity={LIGHTS.directionalIntensity} />
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, -0.3, 0]}>
        <planeGeometry args={[size * 1.5, size * 1.5]} />
        <meshStandardMaterial color={PALETTE.ground} roughness={1} metalness={0} />
      </mesh>
      <gridHelper args={[size, size / step, PALETTE.gridMajor, PALETTE.gridMinor]} position={[0, -0.2, 0]} />
    </>
  );
}

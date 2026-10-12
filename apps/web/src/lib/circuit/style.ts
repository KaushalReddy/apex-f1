/**
 * Visual constants for the circuit scene (sRGB hex). Kept in one place so contrast is testable.
 * Lighting note: Three.js uses physically based units, so a diffuse surface lit by total irradiance E shows roughly
 * albedo * E / PI. Dark albedos therefore need intensities near PI (see CircuitEnvironment) or they render almost black.
 */
export const PALETTE = {
  background: "#0a0c10",
  ground: "#0d1015",
  gridMajor: "#171c24",
  gridMinor: "#12161c",
  asphalt: "#4b5361",
  edge: "#dfe4ec",
  checkerDark: "#101114",
  checkerLight: "#f2f3f5",
} as const;

export const LIGHTS = {
  hemisphereSky: "#cdd6e6",
  hemisphereGround: "#1a2130",
  hemisphereIntensity: 2.2,
  directionalIntensity: 3.2,
  /** Sun elevation above the horizon in degrees; low enough to rake across slopes, high enough to light the road. */
  sunElevationDeg: 38,
  /** Sun azimuth in degrees from +X towards +Z. */
  sunAzimuthDeg: 235,
} as const;

/** Start/finish line layout: squares across the road, rows along it, and its depth as a fraction of the drawn road width. */
export const CHECKER = { cols: 6, rows: 2, depthOfWidth: 0.5 } as const;

/** WCAG relative luminance of an sRGB hex colour. */
export function relativeLuminance(hex: string): number {
  const n = parseInt(hex.slice(1), 16);
  const lin = [(n >> 16) & 255, (n >> 8) & 255, n & 255].map((c) => {
    const v = c / 255;
    return v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * lin[0] + 0.7152 * lin[1] + 0.0722 * lin[2];
}

export function contrastRatio(a: string, b: string): number {
  const [hi, lo] = [relativeLuminance(a), relativeLuminance(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
}

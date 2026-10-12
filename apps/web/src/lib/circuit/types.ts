/** Mirrors packages/contracts/schemas/circuit-geometry.schema.json. Extra `derivation` fields are preserved, never dropped. */
export type Vec3 = readonly [number, number, number];

export interface CircuitDerivation {
  sessionKeys: readonly number[];
  lapsUsed: number;
  sigmaMeters: number;
  stepMeters: number;
  /** Optional provenance written by tools/openf1-spike (see docs/3D_ENGINE.md). */
  scale?: { status: "assumed" | "within-tolerance" | "caveat"; assumedUnitMeters?: number; impliedUnitMeters?: number | null; lengthErrorPct?: number | null };
  startFinishAtIndex0?: boolean;
  spikeVerdict?: string;
  [extra: string]: unknown;
}

export interface CircuitGeometry {
  circuitKey: string;
  coordinateSystem: string;
  /** Metres per coordinate unit. Provisional wherever derivation.scale.status is not "within-tolerance". */
  unitMeters: number;
  closed: boolean;
  /** Centerline [x, y, z] in the SOURCE coordinate system, exactly as derived. Never pre-transformed. */
  points: readonly Vec3[];
  /** null until sourced. The renderer then uses NOMINAL_TRACK_WIDTH_M and says so. */
  widthMeters?: number | null;
  derivation: CircuitDerivation;
}

export type ParseResult = { ok: true; geometry: CircuitGeometry } | { ok: false; error: string };

export type GeometryLoadResult =
  | { status: "ok"; geometry: CircuitGeometry }
  | { status: "missing" }
  | { status: "invalid"; error: string };

/**
 * Procedural car system types. Car space is metres, Y up, +X forward (nose), +Z to the car's left; the origin is the
 * ground plane at mid-wheelbase. Geometry, livery, driver identity, specifications, setup and view state are separate on purpose.
 */
export type Vec3 = readonly [number, number, number];

/** Selectable assemblies. Every id must exist as a real group in the generated scene graph (tested). */
export type ComponentId =
  | "front-wing"
  | "nose-chassis"
  | "halo-cockpit"
  | "wheels"
  | "front-suspension"
  | "rear-suspension"
  | "sidepods-bodywork"
  | "floor"
  | "diffuser"
  | "rear-wing";

export interface CarComponentInfo {
  id: ComponentId;
  label: string;
  /** What the assembly is, in plain language. */
  description: string;
  /** Qualitative, educational aerodynamic role. No figures. */
  aero: string;
}

/**
 * An explodable unit. A component may consist of several parts (e.g. four wheels) that separate in different directions.
 * `explode` is the displacement at full explosion; the base geometry is never mutated.
 */
export interface CarPart {
  key: string;
  component: ComponentId;
  explode: Vec3;
}

/** How a car's geometry relates to the real car. Only `team-specific-verified` may be presented as resembling a specific team's car. */
export type GeometryProvenance = "generic-procedural" | "configurable-variant" | "team-specific-verified";

/** Paint zones of the shared procedural body. Colours only: no logos, sponsor marks or graphics. */
export interface Livery {
  /** Chassis, nose, sidepods, mirrors and the top front-wing flap. */
  primary: string;
  /** Engine cover (upper bodywork). */
  cover: string;
  /** Spine fin that carries the race number. */
  fin: string;
  /** Rear-wing main plane and both wings' endplates. */
  wing: string;
  /** Airbox pod above the driver. */
  accent: string;
  halo: string;
  /** Ring around the wheel rim. */
  rim: string;
  /** Race-number colour. */
  number: string;
}

export type ViewName = "threeQuarter" | "front" | "rear" | "side" | "top";

export type SetupProfileId = "high-downforce" | "balanced" | "low-drag";

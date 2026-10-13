import type { CarComponentInfo, CarPart, ComponentId, Vec3 } from "./types";

/**
 * Component metadata. Descriptions are general, educational explanations of how open-wheel racing cars work, not claims about
 * any team's design. Aero notes are qualitative on purpose: no coefficients, loads or lap-time effects.
 */
export const COMPONENTS: readonly CarComponentInfo[] = [
  {
    id: "front-wing",
    label: "Front wing",
    description: "A multi-element wing mounted to the nose, with endplates at each tip. It is the first part of the car to meet the air.",
    aero: "Turns the oncoming air to push the front axle down, and conditions the flow that reaches the front tyres, floor and sidepods.",
  },
  {
    id: "nose-chassis",
    label: "Nose and chassis",
    description: "The survival cell (monocoque) that carries the driver, fuel cell and front suspension mounts, with the crash-structure nose ahead of it.",
    aero: "The nose shape and its height above the ground affect how much air is fed underneath the car towards the floor.",
  },
  {
    id: "halo-cockpit",
    label: "Halo and cockpit",
    description: "The cockpit opening with the halo, a titanium head-protection structure mounted on three points around the driver.",
    aero: "Mostly a safety structure. It disturbs the air flowing towards the engine-cover intake, which bodywork is shaped around.",
  },
  {
    id: "wheels",
    label: "Wheels and tyres",
    description: "Four slick tyres on 18-inch rims, with hubs and brake discs. Front and rear tyres differ in width.",
    aero: "Exposed rotating wheels create a large, turbulent wake. Much of the bodywork is shaped to steer that wake away from the floor.",
  },
  {
    id: "front-suspension",
    label: "Front suspension",
    description: "Upper and lower wishbones, a pushrod or pullrod to the inboard springs and dampers, and a track rod that steers the wheel.",
    aero: "The links sit in the airflow, so their angles and fairings are shaped to tidy the air passing between the wheels and the chassis.",
  },
  {
    id: "rear-suspension",
    label: "Rear suspension",
    description: "Wishbones and links that locate the rear wheels and carry drive and braking loads into the gearbox casing.",
    aero: "Rear links are packaged around the diffuser and beam-wing area, where airflow quality matters most.",
  },
  {
    id: "sidepods-bodywork",
    label: "Sidepods and bodywork",
    description: "Sidepods house the radiators behind their intakes; the engine cover wraps the power unit and carries the roll-hoop intake.",
    aero: "Bodywork guides air over and around the car towards the rear. Its shape determines how cleanly air reaches the diffuser and rear wing.",
  },
  {
    id: "floor",
    label: "Floor",
    description: "The large, flat-bottomed underbody between the wheels, with shaped leading edges and tunnels underneath.",
    aero: "Air passing under the floor speeds up and its pressure drops, sucking the car towards the track. It is a major source of downforce.",
  },
  {
    id: "diffuser",
    label: "Diffuser",
    description: "The upswept rear section of the floor between the rear wheels.",
    aero: "Expands the fast underfloor air back towards free-stream speed, which helps keep pressure under the floor low.",
  },
  {
    id: "rear-wing",
    label: "Rear wing",
    description: "A main plane and upper flap between two endplates, carried on a central support pillar, with a smaller beam wing below.",
    aero: "Produces downforce on the rear axle at the cost of drag. Its angle is one of the most visible trade-offs between grip and straight-line speed.",
  },
];

const X = 0.6; // lateral explode distance for side-mounted parts (m)
const LIFT = 0.45; // the body lifts clear of the floor, which stays on the ground (it cannot move down without going below it)

/** Every explodable part. A part key matches exactly one group in the scene graph (tested). */
export const PARTS: readonly CarPart[] = [
  { key: "front-wing", component: "front-wing", explode: [1.0, 0.15, 0] },
  { key: "nose-chassis", component: "nose-chassis", explode: [0.25, LIFT, 0] },
  { key: "halo-cockpit", component: "halo-cockpit", explode: [0.15, LIFT + 0.6, 0] },
  { key: "wheel-fl", component: "wheels", explode: [0.25, 0, X + 0.4] },
  { key: "wheel-fr", component: "wheels", explode: [0.25, 0, -(X + 0.4)] },
  { key: "wheel-rl", component: "wheels", explode: [-0.25, 0, X + 0.4] },
  { key: "wheel-rr", component: "wheels", explode: [-0.25, 0, -(X + 0.4)] },
  { key: "front-suspension-l", component: "front-suspension", explode: [0.1, LIFT * 0.6, X * 0.55] },
  { key: "front-suspension-r", component: "front-suspension", explode: [0.1, LIFT * 0.6, -X * 0.55] },
  { key: "rear-suspension-l", component: "rear-suspension", explode: [-0.1, LIFT * 0.6, X * 0.55] },
  { key: "rear-suspension-r", component: "rear-suspension", explode: [-0.1, LIFT * 0.6, -X * 0.55] },
  { key: "sidepod-l", component: "sidepods-bodywork", explode: [0, LIFT, X] },
  { key: "sidepod-r", component: "sidepods-bodywork", explode: [0, LIFT, -X] },
  { key: "engine-cover", component: "sidepods-bodywork", explode: [-0.15, LIFT + 0.5, 0] },
  { key: "floor", component: "floor", explode: [0, 0, 0] },
  { key: "diffuser", component: "diffuser", explode: [-0.6, 0, 0] },
  { key: "rear-wing", component: "rear-wing", explode: [-0.9, LIFT + 0.3, 0] },
];

export const componentInfo = (id: ComponentId): CarComponentInfo => {
  const c = COMPONENTS.find((x) => x.id === id);
  if (!c) throw new Error(`Unknown car component: ${id}`);
  return c;
};

export const partsOf = (id: ComponentId) => PARTS.filter((p) => p.component === id);

export function partExplode(key: string): Vec3 {
  const p = PARTS.find((x) => x.key === key);
  if (!p) throw new Error(`Unknown car part: ${key}`);
  return p.explode;
}

/** Smoothstep easing for the explode transition. */
export const easeExplode = (t: number) => {
  const c = Math.min(1, Math.max(0, t));
  return c * c * (3 - 2 * c);
};

/**
 * Advances explode progress towards the target (0 assembled, 1 exploded) by dt seconds over `duration` seconds.
 * A non-positive duration (reduced motion) jumps straight to the target. Progress is always clamped to [0, 1].
 */
export function stepExplode(current: number, target: 0 | 1, dt: number, duration: number): number {
  if (duration <= 0) return target;
  const step = Math.max(0, dt) / duration;
  return target > current ? Math.min(current + step, target) : Math.max(current - step, target);
}

/** Offset of a part at the given explode progress: `explode * ease(progress)`. Written into `out` to avoid per-frame allocation. */
export function explodeOffsetInto(out: { set(x: number, y: number, z: number): unknown }, explode: Vec3, progress: number) {
  const e = easeExplode(progress);
  out.set(explode[0] * e, explode[1] * e, explode[2] * e);
}

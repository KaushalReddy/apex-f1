"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { Html } from "@react-three/drei";
import { useFrame, useThree, type ThreeEvent } from "@react-three/fiber";
import {
  CanvasTexture,
  Color,
  DoubleSide,
  MeshBasicMaterial,
  MeshLambertMaterial,
  MeshPhysicalMaterial,
  MeshStandardMaterial,
  SRGBColorSpace,
  type BufferGeometry,
  type Group,
  type Material,
} from "three";
import { COMPONENTS, PARTS, explodeOffsetInto, stepExplode } from "@/lib/car/components";
import { DECALS, PART_ASSEMBLY, type CarGeometry, type MaterialKey, type MeshSpec } from "@/lib/car/geometry";
import type { ComponentId, Livery, Vec3 } from "@/lib/car/types";

const EXPLODE_SECONDS = 0.7;

interface Highlight {
  selected: ComponentId | null;
  hovered: ComponentId | null;
  pressure: boolean;
}
const HighlightCtx = createContext<Highlight>({ selected: null, hovered: null, pressure: false });
const ComponentCtx = createContext<ComponentId | null>(null);

type Mats = ReturnType<typeof makeMaterials>;
const MatsCtx = createContext<Mats | null>(null);

function makeMaterials(livery: Livery) {
  const physical = (color: string, roughness: number, metalness: number, clearcoat = 0) =>
    new MeshPhysicalMaterial({ color: new Color(color), roughness, metalness, clearcoat, clearcoatRoughness: 0.08 });
  const overlay = (color: string, opacity: number) =>
    new MeshBasicMaterial({ color, transparent: true, opacity, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 });
  const surfaces: Record<MaterialKey, Material> = {
    paint: physical(livery.primary, 0.38, 0.15, 1),
    cover: physical(livery.cover, 0.38, 0.15, 1),
    fin: physical(livery.fin, 0.4, 0.15, 1),
    wing: physical(livery.wing, 0.4, 0.15, 1),
    accent: physical(livery.accent, 0.38, 0.15, 1),
    rimRing: physical(livery.rim, 0.35, 0.4, 0.6),
    // Matte and weakly reflective: at grazing angles a glossy finish turns the large floor light grey.
    carbon: Object.assign(physical("#0f1114", 0.7, 0.1), { envMapIntensity: 0.35, specularIntensity: 0.35 }),
    rubber: new MeshStandardMaterial({ color: "#16171a", roughness: 0.88, metalness: 0 }),
    rim: physical("#2a2e35", 0.32, 0.75, 0.4),
    metal: physical("#b4bcc6", 0.22, 0.95),
    halo: physical(livery.halo, 0.36, 0.3, 0.8),
    dark: new MeshStandardMaterial({ color: "#040506", roughness: 1, metalness: 0, side: DoubleSide }),
    band: new MeshStandardMaterial({ color: "#c9ced6", roughness: 0.7, side: DoubleSide }), // plain sidewall marking ring, no branding
    plank: new MeshStandardMaterial({ color: "#4a3b2a", roughness: 0.8 }),
    light: new MeshBasicMaterial({ color: "#ff3b30" }),
    helmet: physical("#e9edf2", 0.3, 0.1, 1), // neutral helmet: no driver design is reproduced
    visor: physical("#07080a", 0.08, 0.9, 1),
  };
  return {
    surfaces,
    // Illustrative pressure map: reads the per-vertex colours baked by lib/car/pressure.ts.
    pressure: new MeshLambertMaterial({ vertexColors: true }), // matte: no reflections washing out the map
    // Design-system accent (accent-strong) for selection; a quieter fg tint for hover.
    selected: overlay("#ff6b63", 0.42),
    hovered: overlay("#f3f5f7", 0.16),
  };
}

/** One mesh. When its component is selected or hovered, the SAME geometry is drawn again with an overlay material (no buffer copies). */
function Piece({ spec }: { spec: MeshSpec }) {
  const component = useContext(ComponentCtx);
  const { selected, hovered, pressure } = useContext(HighlightCtx);
  const mats = useContext(MatsCtx)!;
  const overlay = component && selected === component ? mats.selected : component && hovered === component ? mats.hovered : null;
  const material = pressure && spec.material !== "dark" && spec.material !== "visor" ? mats.pressure : mats.surfaces[spec.material];
  return (
    <group position={spec.position} rotation={spec.rotation} quaternion={spec.quaternion} scale={spec.scale}>
      <mesh geometry={spec.geometry} material={material} castShadow receiveShadow />
      {overlay && <mesh geometry={spec.geometry} material={overlay} renderOrder={2} raycast={() => null} />}
    </group>
  );
}

const MIRROR: Vec3 = [1, 1, -1];

/** Where each component's label sits (car space, before explode), on the part that carries it. */
const LABEL_AT: Partial<Record<string, [ComponentId, Vec3]>> = {
  "front-wing": ["front-wing", [2.35, 0.42, 0]],
  "nose-chassis": ["nose-chassis", [1.5, 0.66, 0]],
  "halo-cockpit": ["halo-cockpit", [0.3, 1.06, 0]],
  "wheel-fl": ["wheels", [1.7, 0.85, 0.8]],
  "front-suspension-l": ["front-suspension", [1.65, 0.7, 0.4]],
  "rear-suspension-l": ["rear-suspension", [-1.7, 0.7, 0.4]],
  "sidepod-l": ["sidepods-bodywork", [0, 0.74, 0.45]],
  floor: ["floor", [0.4, 0.14, 0.76]],
  diffuser: ["diffuser", [-1.95, 0.46, 0]],
  "rear-wing": ["rear-wing", [-2.1, 1.2, 0]],
};

interface PartApi {
  parts: Map<string, Group>;
  showLabels: boolean;
  onSelect: (id: ComponentId) => void;
  onHover: (id: ComponentId | null) => void;
}
const PartCtx = createContext<PartApi | null>(null);

/** One explodable part: a group registered with the explode loop, carrying its component id for picking and highlighting. */
function Part({ partKey, children }: { partKey: string; children: ReactNode }) {
  const api = useContext(PartCtx)!;
  const component = PARTS.find((p) => p.key === partKey)!.component;
  const label = api.showLabels ? LABEL_AT[partKey] : undefined;
  const { parts } = api;
  const ref = useCallback(
    (el: Group | null) => {
      if (el) parts.set(partKey, el);
      else parts.delete(partKey);
    },
    [parts, partKey],
  );
  return (
    <group
      ref={ref}
      name={partKey}
      userData={{ componentId: component }}
      onClick={(e: ThreeEvent<MouseEvent>) => {
        if (e.delta > 6) return; // a drag that orbited the camera, not a click
        e.stopPropagation();
        api.onSelect(component);
      }}
      onPointerOver={(e: ThreeEvent<PointerEvent>) => {
        e.stopPropagation();
        api.onHover(component);
      }}
      onPointerOut={() => api.onHover(null)}
    >
      <ComponentCtx.Provider value={component}>{children}</ComponentCtx.Provider>
      {label && (
        <Html position={label[1]} center zIndexRange={[20, 0]} style={{ pointerEvents: "none" }}>
          <span aria-hidden="true" className="whitespace-nowrap rounded-sm border border-line-strong bg-surface-3/90 px-1.5 py-0.5 text-xs font-medium text-fg">
            {COMPONENTS.find((c) => c.id === label[0])!.label}
          </span>
        </Html>
      )}
    </group>
  );
}

interface Props {
  geometry: CarGeometry;
  livery: Livery;
  number?: number;
  selected: ComponentId | null;
  hovered: ComponentId | null;
  exploded: boolean;
  reducedMotion: boolean;
  /** Paint the illustrative surface-pressure map instead of the livery. */
  pressure?: boolean;
  onSelect: (id: ComponentId) => void;
  onHover: (id: ComponentId | null) => void;
  /** Name labels while exploded (DOM overlays; off in headless tests). */
  labels?: boolean;
}

/**
 * The procedural car. Each explodable part is one group (see PART_ASSEMBLY) whose position is driven by a single explode loop; base
 * geometry is never mutated, and mirrored parts reuse the left-side buffers with a negative Z scale. Picking uses the real meshes, so
 * an exploded part is selected where it is drawn.
 */
export function CarModel({ geometry: g, livery, number, selected, hovered, exploded, reducedMotion, pressure = false, onSelect, onHover, labels = true }: Props) {
  const mats = useMemo(() => makeMaterials(livery), [livery]);
  useEffect(
    () => () => {
      Object.values(mats.surfaces).forEach((m) => m.dispose());
      [mats.pressure, mats.selected, mats.hovered].forEach((m) => m.dispose());
    },
    [mats],
  );

  const [parts] = useState(() => new Map<string, Group>());
  const progress = useRef(exploded ? 1 : 0);
  const invalidate = useThree((s) => s.invalidate);
  // Floating labels crowd a narrow canvas; there the component list below the view names every part instead.
  const roomForLabels = useThree((s) => s.size.width >= 560);
  useEffect(() => invalidate(), [exploded, invalidate]);

  useFrame((_, dt) => {
    const target = exploded ? 1 : 0;
    // Clamp dt: on-demand rendering can report a long delta after an idle period.
    progress.current = stepExplode(progress.current, target, Math.min(dt, 1 / 30), reducedMotion ? 0 : EXPLODE_SECONDS);
    for (const p of PARTS) {
      const group = parts.get(p.key);
      if (group) explodeOffsetInto(group.position, p.explode, progress.current);
    }
    if (progress.current !== target) invalidate();
  });

  return (
    <PartCtx.Provider value={{ parts, showLabels: exploded && labels && roomForLabels, onSelect, onHover }}>
      <MatsCtx.Provider value={mats}>
        <HighlightCtx.Provider value={{ selected, hovered, pressure }}>
          <group name="car">
            {PARTS.map((p) => {
              const layout = PART_ASSEMBLY[p.key];
              return (
                <Part key={p.key} partKey={p.key}>
                  <group position={layout.position} scale={layout.mirror ? MIRROR : undefined}>
                    {g.assemblies[layout.assembly].map((s, i) => (
                      <Piece key={i} spec={s} />
                    ))}
                  </group>
                  {number !== undefined && !pressure && DECALS.some((d) => d.part === p.key) && (
                    <NumberDecals geometry={g.decal} number={number} color={livery.number} partKey={p.key} />
                  )}
                </Part>
              );
            })}
          </group>
        </HighlightCtx.Provider>
      </MatsCtx.Provider>
    </PartCtx.Provider>
  );
}

/** Race-number decals (nose and engine-cover fin), drawn into a small canvas texture (no font download). */
function NumberDecals({ geometry, number, color, partKey }: { geometry: BufferGeometry; number: number; color: string; partKey: string }) {
  const material = useMemo(() => {
    if (typeof document === "undefined") return null;
    const canvas = document.createElement("canvas");
    canvas.width = 256;
    canvas.height = 160;
    const ctx = canvas.getContext("2d");
    if (!ctx) return null;
    ctx.fillStyle = color;
    ctx.font = "italic 700 132px system-ui, -apple-system, 'Segoe UI', Arial, sans-serif";
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText(String(number), 128, 86);
    const map = new CanvasTexture(canvas);
    map.colorSpace = SRGBColorSpace;
    map.anisotropy = 4;
    return new MeshBasicMaterial({ map, transparent: true, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -4, polygonOffsetUnits: -4 });
  }, [number, color]);
  useEffect(
    () => () => {
      material?.map?.dispose();
      material?.dispose();
    },
    [material],
  );
  if (!material) return null;
  return (
    <>
      {DECALS.filter((d) => d.part === partKey).map((d, i) => (
        <group key={i} position={d.position} rotation={[0, 0, d.tilt ?? 0]}>
          <mesh geometry={geometry} material={material} rotation={d.rotation} scale={[d.size[0], d.size[1], 1]} raycast={() => null} />
        </group>
      ))}
    </>
  );
}

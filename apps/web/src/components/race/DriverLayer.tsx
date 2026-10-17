"use client";

import { useEffect, useMemo, useRef, type MutableRefObject } from "react";
import { useFrame, useThree, type ThreeEvent } from "@react-three/fiber";
import {
  AdditiveBlending,
  CanvasTexture,
  Color,
  DoubleSide,
  MeshBasicMaterial,
  RingGeometry,
  SphereGeometry,
  SpriteMaterial,
  Vector3,
  type Group,
} from "three";
import { useCircuitTransform } from "@/components/circuit/CircuitFrame";
import { centerlineToWorld } from "@/lib/circuit/transform";
import type { CircuitGeometry } from "@/lib/circuit/types";
import { labelPriority, placeLabels, type LabelAnchor, type LabelPlacement } from "@/lib/race/declutter";
import type { SnapshotBuffer } from "@/lib/race/session";
import { createTrackPath } from "@/lib/race/track";

export interface MarkerDriver {
  id: string;
  color: string;
  position: number | null;
  stale: boolean;
  /** Circuit focus: drawn as a subdued wireframe without glow or label (lib/race/visibility). Purely visual. */
  hollow?: boolean;
}

interface Props {
  geometry: CircuitGeometry;
  drivers: readonly MarkerDriver[];
  buffer: MutableRefObject<SnapshotBuffer>;
  /** DOM container holding one `[data-label-id]` element per driver (rendered by the page, positioned here). */
  labels: MutableRefObject<HTMLDivElement | null>;
  showLabels: boolean;
  selected: string | null;
  focus: readonly string[];
  follow: boolean;
  /** While true the layer keeps requesting frames (the circuit scene otherwise renders on demand). */
  animating: boolean;
  onSelect: (id: string) => void;
  onHover: (id: string | null) => void;
  /**
   * Neutralisation from race control. "safety-car": a bright yellow sphere SAFETY_CAR_AHEAD_M ahead of the leader. APPROXIMATE: the
   * Safety Car's own position is not in the data; it leads the field, so it is drawn just ahead of P1 and labelled "SC (approx.)".
   * "vsc": no car exists; the page draws the track outline instead. Labels `[data-label-id="__sc"]` / `"__vsc"` are placed here.
   */
  neutral?: { kind: "safety-car" | "vsc"; leaderId: string | null } | null;
}

/** How far ahead of the leader the approximate Safety Car is drawn (metres along the centerline). */
export const SAFETY_CAR_AHEAD_M = 80;
const SAFETY_CAR = "#ffd60a"; // bright yellow, brighter than any team colour or the leader ring

const LEADER = "#f5b83d"; // warning token: a quiet gold ring for P1
const FOCUS = "#5cb8ff"; // info token: battle focus
const SELECTED = "#f3f5f7"; // fg token

/** Halo sprite size relative to the marker core: normal views, and the straight-down view where markers are small and packed. */
const HALO = 6;
const HALO_TOP_DOWN = 3;

/** Soft round glow drawn once on a small canvas (no texture download). */
function glowTexture() {
  if (typeof document === "undefined") return null;
  const c = Object.assign(document.createElement("canvas"), { width: 64, height: 64 });
  const ctx = c.getContext("2d");
  if (!ctx) return null;
  const g = ctx.createRadialGradient(32, 32, 0, 32, 32, 32);
  g.addColorStop(0, "rgba(255,255,255,0.9)");
  g.addColorStop(0.25, "rgba(255,255,255,0.45)");
  g.addColorStop(1, "rgba(255,255,255,0)");
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, 64, 64);
  return new CanvasTexture(c);
}

/**
 * Driver markers on the Phase 3 circuit. Compact luminous core + translucent halo in the team colour; thin rings mark the selected
 * driver, the leader and a focused battle. Positions come from the interpolation buffer every frame and are written straight to the
 * scene objects (no React renders per frame); markers keep a constant on-screen size at any zoom. Labels are DOM elements positioned
 * and decluttered here.
 */
export function DriverLayer({ geometry, drivers, buffer, labels, showLabels, selected, focus, follow, animating, onSelect, onHover, neutral = null }: Props) {
  const transform = useCircuitTransform();
  // The same world centerline the track mesh is built from, through the same transform: markers cannot disagree with the road.
  const path = useMemo(() => createTrackPath(centerlineToWorld(geometry, transform)), [geometry, transform]);
  const invalidate = useThree((s) => s.invalidate);

  const shared = useMemo(() => {
    const glow = glowTexture();
    return {
      core: new SphereGeometry(1, 20, 14),
      hit: new SphereGeometry(3.2, 10, 8),
      ring: new RingGeometry(1.9, 2.25, 40).rotateX(-Math.PI / 2),
      // Hollowed-out driver: a coarse wireframe of the core, readable as "a car is here" from any angle without a bright centre.
      hollow: new SphereGeometry(1.15, 8, 6),
      hitMat: new MeshBasicMaterial({ transparent: true, opacity: 0, depthWrite: false }),
      glow,
    };
  }, []);
  // Materials depend only on the set of team colours, not on every 4 Hz update of the driver list.
  const colorKey = useMemo(() => [...new Set(drivers.map((d) => d.color))].sort().join("|"), [drivers]);
  const mats = useMemo(() => {
    const byColor = new Map<string, { core: MeshBasicMaterial; halo: SpriteMaterial; haloStale: SpriteMaterial; hollow: MeshBasicMaterial }>();
    for (const color of colorKey.split("|").filter(Boolean)) {
      const c = new Color(color);
      byColor.set(color, {
        core: new MeshBasicMaterial({ color: c.clone().lerp(new Color("#ffffff"), 0.35), transparent: true, opacity: 0.95 }),
        halo: new SpriteMaterial({ map: shared.glow ?? undefined, color: c, transparent: true, opacity: 0.85, blending: AdditiveBlending, depthWrite: false }),
        // Stale data: a dimmer halo so the marker reads as "last known position".
        haloStale: new SpriteMaterial({ map: shared.glow ?? undefined, color: c, transparent: true, opacity: 0.25, blending: AdditiveBlending, depthWrite: false }),
        // Team hue pulled towards the neutral subtle tone and kept faint, so it never reads brighter (or more important) than a focused car.
        hollow: new MeshBasicMaterial({ color: c.clone().lerp(new Color("#8a94a2"), 0.55), wireframe: true, transparent: true, opacity: 0.5, depthWrite: false }),
      });
    }
    return byColor;
  }, [colorKey, shared.glow]);
  const scMats = useMemo(
    () => ({
      core: new MeshBasicMaterial({ color: SAFETY_CAR, transparent: true, opacity: 1 }),
      halo: new SpriteMaterial({ map: shared.glow ?? undefined, color: SAFETY_CAR, transparent: true, opacity: 1, blending: AdditiveBlending, depthWrite: false }),
    }),
    [shared.glow],
  );
  useEffect(
    () => () => {
      scMats.core.dispose();
      scMats.halo.dispose();
    },
    [scMats],
  );
  const scGroup = useRef<Group | null>(null);
  const ringMats = useMemo(
    () => ({
      selected: new MeshBasicMaterial({ color: SELECTED, side: DoubleSide, depthTest: false, transparent: true, opacity: 0.95 }),
      leader: new MeshBasicMaterial({ color: LEADER, side: DoubleSide, depthTest: false, transparent: true, opacity: 0.8 }),
      focus: new MeshBasicMaterial({ color: FOCUS, side: DoubleSide, depthTest: false, transparent: true, opacity: 0.9 }),
    }),
    [],
  );
  useEffect(
    () => () => {
      for (const m of mats.values()) {
        m.core.dispose();
        m.halo.dispose();
        m.haloStale.dispose();
        m.hollow.dispose();
      }
    },
    [mats],
  );
  useEffect(
    () => () => {
      shared.core.dispose();
      shared.hit.dispose();
      shared.ring.dispose();
      shared.hollow.dispose();
      shared.hitMat.dispose();
      shared.glow?.dispose();
      Object.values(ringMats).forEach((m) => m.dispose());
    },
    [shared, ringMats],
  );

  const groups = useRef(new Map<string, Group>());
  /** Label sizes measured in full form, reused while a label is shown compact (code only). */
  const labelSizes = useRef(new Map<string, { w: number; wCompact: number; h: number }>());
  /** Last frame's placements, so each label keeps its side while that spot stays free. */
  const lastPlacement = useRef<Map<string, LabelPlacement>>(new Map());
  const progress = useMemo(() => new Map<string, number>(), []);
  const tmp = useMemo(() => [0, 0, 0], []);
  const v = useMemo(() => new Vector3(), []);

  useEffect(() => invalidate(), [selected, focus, showLabels, drivers, neutral, invalidate]); // drivers carry `hollow`: a focus change redraws once

  useFrame((state) => {
    const { camera, size, controls } = state;
    // Snapshots are stamped with performance.now() (see realScheduler), so sample on the same clock.
    buffer.current.sample(performance.now(), progress);
    const anchors: LabelAnchor[] = [];
    const screen = new Map<string, { mx: number; my: number }>();
    const container = labels.current;
    let markerPx = 6;
    // Looking (almost) straight down, the camera is far away and markers sit close together on screen: a full-size glow would merge
    // into one blob over the track, so the halo is drawn at half size there.
    const halo = camera.getWorldDirection(v).y < -0.9 ? HALO_TOP_DOWN : HALO;
    for (const d of drivers) {
      const g = groups.current.get(d.id);
      if (!g) continue;
      const p = progress.get(d.id);
      g.visible = p != null;
      if (p == null) continue;
      path.pointAt(p, tmp);
      const dist = camera.position.distanceTo(v.set(tmp[0], tmp[1], tmp[2]));
      // Constant on-screen size: scale with distance AND the lens (the top-down view uses a narrower field of view than the 40° the
      // factor was tuned for, which would otherwise make markers about twice as large there).
      const lens = Math.tan((((camera as unknown as { fov?: number }).fov ?? 40) * Math.PI) / 360) / Math.tan((40 * Math.PI) / 360);
      const s = Math.max(1.2, dist * 0.0072 * lens);
      g.scale.setScalar(s);
      g.getObjectByName("halo")?.scale.set(halo, halo, 1); // hollowed-out markers have none
      g.position.set(tmp[0], tmp[1] + s * 0.9 + 0.5, tmp[2]);
      // Marker core radius on screen, so labels clear the marker at any zoom.
      const fov = (camera as unknown as { fov?: number }).fov ?? 40;
      // The solid core, not the soft halo: labels may overlap the glow, which keeps more of them beside a tight pack.
      markerPx = Math.max(4, (s * size.height) / (2 * dist * Math.tan((fov * Math.PI) / 360)));

      if (container) {
        // Project the marker exactly as the renderer does (same camera, same canvas size), so the label cannot drift from it.
        v.copy(g.position).project(camera);
        if (v.z > 1 || v.z < -1) continue; // behind the camera or outside the depth range
        const mx = ((v.x + 1) / 2) * size.width;
        const my = ((1 - v.y) / 2) * size.height;
        screen.set(d.id, { mx, my });
        const el = container.querySelector<HTMLElement>(`[data-label-id="${d.id}"]`);
        if (!el) continue;
        if (el.dataset.compact !== "true" || !labelSizes.current.has(d.id)) {
          const pos = el.querySelector<HTMLElement>("[data-pos]");
          const w = el.offsetWidth;
          labelSizes.current.set(d.id, { w, wCompact: w - (pos ? pos.offsetWidth + 4 : 0), h: el.offsetHeight });
        }
        const sz = labelSizes.current.get(d.id)!;
        // Hollowed-out drivers keep no label (unless selected), so the focused ones stay readable.
        if (d.hollow && d.id !== selected) continue;
        anchors.push({ id: d.id, mx, my, ...sz, priority: labelPriority({ selected: d.id === selected, focused: focus.includes(d.id), position: d.position }) });
      }
    }
    if (container) {
      // Labels off: only the selected driver keeps one, so it stays identifiable.
      const list = showLabels ? anchors : anchors.filter((a) => a.id === selected);
      const placed = placeLabels(list, { w: size.width, h: size.height }, { markerR: markerPx, mustShow: selected, previous: lastPlacement.current });
      lastPlacement.current = placed;
      for (const d of drivers) {
        const el = container.querySelector<HTMLElement>(`[data-label-id="${d.id}"]`);
        const pl = placed.get(d.id);
        if (!el) continue;
        if (!pl || !screen.has(d.id)) {
          el.dataset.visible = "false";
          continue;
        }
        el.dataset.visible = "true";
        el.dataset.compact = String(pl.compact);
        el.style.transform = `translate3d(${pl.x.toFixed(1)}px, ${pl.y.toFixed(1)}px, 0)`;
      }
    }

    // Safety Car (approximate) just ahead of the leader, and the VSC label at the start/finish line; both labels follow their 3D point.
    const placeTag = (id: string, x: number, y: number, z: number, show: boolean) => {
      const el = container?.querySelector<HTMLElement>(`[data-label-id="${id}"]`);
      if (!el) return;
      v.set(x, y, z).project(camera);
      const on = show && v.z <= 1 && v.z >= -1;
      el.dataset.visible = String(on);
      if (on) el.style.transform = `translate3d(${(((v.x + 1) / 2) * size.width + 10).toFixed(1)}px, ${(((1 - v.y) / 2) * size.height - 22).toFixed(1)}px, 0)`;
    };
    const sc = scGroup.current;
    if (sc) {
      const lp = neutral?.kind === "safety-car" && neutral.leaderId ? progress.get(neutral.leaderId) : undefined;
      sc.visible = lp != null;
      if (lp != null) {
        path.pointAt(lp + SAFETY_CAR_AHEAD_M / path.length, tmp);
        const dist = camera.position.distanceTo(v.set(tmp[0], tmp[1], tmp[2]));
        const lens = Math.tan((((camera as unknown as { fov?: number }).fov ?? 40) * Math.PI) / 360) / Math.tan((40 * Math.PI) / 360);
        const s = Math.max(1.2, dist * 0.0072 * lens) * 1.35;
        sc.scale.setScalar(s);
        sc.position.set(tmp[0], tmp[1] + s * 0.9 + 0.5, tmp[2]);
        placeTag("__sc", sc.position.x, sc.position.y, sc.position.z, true);
      } else placeTag("__sc", 0, 0, 0, false);
    }
    if (neutral?.kind === "vsc") {
      path.pointAt(0, tmp);
      placeTag("__vsc", tmp[0], tmp[1] + 2, tmp[2], true);
    } else placeTag("__vsc", 0, 0, 0, false);

    // Follow: move the orbit target with the selected car and carry the camera along, so the user's chosen angle and zoom are kept.
    const ctl = controls as unknown as { target: Vector3; update(): void } | null;
    const sel = selected ? groups.current.get(selected) : undefined;
    if (follow && sel?.visible && ctl) {
      const k = 0.15;
      const dx = (sel.position.x - ctl.target.x) * k;
      const dz = (sel.position.z - ctl.target.z) * k;
      ctl.target.x += dx;
      ctl.target.z += dz;
      camera.position.x += dx;
      camera.position.z += dz;
      ctl.update();
    }

    if (animating || follow) invalidate();
  });


  return (
    <group name="drivers">
      {neutral?.kind === "safety-car" && (
        <group ref={scGroup} name="safety-car" renderOrder={8}>
          <sprite name="halo" scale={[HALO + 2, HALO + 2, 1]} material={scMats.halo} raycast={() => null} renderOrder={8} />
          <mesh geometry={shared.core} material={scMats.core} renderOrder={9} raycast={() => null} />
        </group>
      )}
      {drivers.map((d) => {
        const m = mats.get(d.color)!;
        const ring = d.id === selected ? ringMats.selected : d.hollow ? null : focus.includes(d.id) ? ringMats.focus : d.position === 1 ? ringMats.leader : null;
        return (
          <group
            key={d.id}
            name={`driver-${d.id}`}
            ref={(el) => {
              if (el) groups.current.set(d.id, el);
              else groups.current.delete(d.id);
            }}
            onClick={(e: ThreeEvent<MouseEvent>) => {
              if (e.delta > 6) return;
              e.stopPropagation();
              onSelect(d.id);
            }}
            onPointerOver={(e: ThreeEvent<PointerEvent>) => {
              e.stopPropagation();
              onHover(d.id);
            }}
            onPointerOut={() => onHover(null)}
          >
            {d.hollow ? (
              <mesh geometry={shared.hollow} material={m.hollow} renderOrder={4} raycast={() => null} />
            ) : (
              <>
                <sprite name="halo" scale={[HALO, HALO, 1]} material={d.stale ? m.haloStale : m.halo} raycast={() => null} renderOrder={5} />
                <mesh geometry={shared.core} material={m.core} renderOrder={6} raycast={() => null} />
              </>
            )}
            {ring && <mesh geometry={shared.ring} material={ring} renderOrder={7} raycast={() => null} />}
            {/* Invisible, larger pick target so small markers stay easy to tap. */}
            <mesh geometry={shared.hit} material={shared.hitMat} />
          </group>
        );
      })}
    </group>
  );
}

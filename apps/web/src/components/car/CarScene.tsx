"use client";

import { useEffect, useMemo } from "react";
import { Canvas, useStore } from "@react-three/fiber";
import { Box3, CanvasTexture, Color, PMREMGenerator, PerspectiveCamera, Sphere, Vector3, WebGLRenderTarget, type Object3D } from "three";
import { RoomEnvironment } from "three/examples/jsm/environments/RoomEnvironment.js";
import type { FlowSettings } from "@/lib/car/airflow";
import { CAR_FOV, cameraPreset } from "@/lib/car/camera";
import { assembleCar, buildBodyGeometry, buildWingGeometry, disposeCarGeometry, type WingAngles } from "@/lib/car/geometry";
import { COMPONENTS } from "@/lib/car/components";
import type { ComponentId, Livery } from "@/lib/car/types";
import { Airflow, type AeroLayers } from "./Airflow";
import { CarCamera, type CarFocus, type CarViewPreset, type FrameInsets } from "./CarCamera";
import type { AeroFocus, PartMode } from "@/lib/car/lab";
import type { CfdResult } from "@/lib/cfd/model";
import type { FieldName } from "./cfdPaint";
import { CfdSlice } from "./CfdSlice";
import { CarModel } from "./CarModel";

export interface CarSceneProps {
  wings: WingAngles;
  livery: Livery;
  number?: number;
  preset: CarViewPreset;
  selected: ComponentId | null;
  hovered: ComponentId | null;
  exploded: boolean;
  aero: boolean;
  aeroPlaying: boolean;
  aeroLayers: AeroLayers;
  pressure: boolean;
  flow: FlowSettings;
  autoRotate: boolean;
  reducedMotion: boolean;
  onSelect: (id: ComponentId) => void;
  onHover: (id: ComponentId | null) => void;
  /** Receives a small render of each component (PNG data URLs) whenever the livery or wing geometry changes. */
  onThumbnails?: (thumbs: Partial<Record<ComponentId, string>>) => void;
  /** Car Lab extensions (all optional; the Phase 4 viewer does not pass them). */
  explode?: number;
  modes?: Readonly<Record<string, PartMode>>;
  annotate?: boolean;
  focus?: CarFocus | null;
  /** Panels over the canvas (Car Lab, large screens): the car is framed in the space between them. */
  insets?: FrameInsets;
  aeroFocus?: AeroFocus;
  /** A computed SU2 flow-field slice to draw at its section (replaces the conceptual airflow while shown). */
  cfdSlice?: { result: CfdResult; field: FieldName } | null;
}

const THUMB_W = 320;
const THUMB_H = 200;
const SS = 2; // supersampling factor: render at 2x, downscale on a 2D canvas for smooth edges
const SRGB = Array.from({ length: 256 }, (_, v) => {
  const c = v / 255;
  return Math.round(255 * (c <= 0.0031308 ? 12.92 * c : 1.055 * c ** (1 / 2.4) - 0.055));
});

/**
 * Renders each component of the real procedural model on its own (everything else hidden) into an offscreen target, for the component
 * cards. Runs once per livery/wing change, one component per idle moment (rendering them all at once froze the page for ~0.3 s on a fast
 * desktop, ~0.7 s on a phone-class CPU); each capture restores visibility, render target and clear colour before it returns, so the live
 * view never shows a half-hidden car. Thumbnails are reported as they arrive.
 */
function ThumbnailCapture({ livery, wings, onThumbnails }: { livery: Livery; wings: WingAngles; onThumbnails?: CarSceneProps["onThumbnails"] }) {
  const store = useStore();
  useEffect(() => {
    if (!onThumbnails || typeof document === "undefined") return;
    const W = THUMB_W * SS;
    const H = THUMB_H * SS;
    const rt = new WebGLRenderTarget(W, H);
    const cam = new PerspectiveCamera(28, W / H, 0.01, 100);
    const big = Object.assign(document.createElement("canvas"), { width: W, height: H });
    const small = Object.assign(document.createElement("canvas"), { width: THUMB_W, height: THUMB_H });
    const bctx = big.getContext("2d");
    const sctx = small.getContext("2d");
    const buf = new Uint8Array(W * H * 4);
    const out: Partial<Record<ComponentId, string>> = {};
    let cancelled = false;

    /** Captures one component; false when the car is not in the scene yet (it builds asynchronously), so the caller tries again later. */
    const capture = (comp: (typeof COMPONENTS)[number]): boolean => {
      const { gl, scene, invalidate } = store.getState();
      const car = scene.getObjectByName("car");
      if (!car || !bctx || !sctx) return false;
      const prevTarget = gl.getRenderTarget();
      const prevClear = gl.getClearColor(new Color());
      const prevAlpha = gl.getClearAlpha();
      const hidden: Object3D[] = [];
      for (const c of scene.children)
        if (c !== car && c.visible && !(c as { isLight?: boolean }).isLight) {
          c.visible = false;
          hidden.push(c);
        }
      try {
        const box = new Box3();
        for (const g of car.children) {
          const on = g.userData.componentId === comp.id;
          g.visible = on;
          if (on) box.expandByObject(g);
        }
        if (box.isEmpty()) return true;
        const centre = box.getCenter(new Vector3());
        const radius = box.getBoundingSphere(new Sphere()).radius;
        const dist = (radius / Math.sin((cam.fov * Math.PI) / 360)) * 0.92;
        cam.position.copy(centre).addScaledVector(new Vector3(0.62, 0.42, 0.66).normalize(), dist);
        cam.lookAt(centre);
        cam.near = dist / 100;
        cam.far = dist * 10;
        cam.updateProjectionMatrix();
        gl.setClearColor(0x000000, 0);
        gl.setRenderTarget(rt);
        gl.clear();
        gl.render(scene, cam);
        gl.readRenderTargetPixels(rt, 0, 0, W, H, buf);
        // Render targets are linear and bottom-up: flip rows and encode to sRGB for display.
        const img = bctx.createImageData(W, H);
        for (let y = 0; y < H; y++)
          for (let x = 0; x < W; x++) {
            const s = ((H - 1 - y) * W + x) * 4;
            const d = (y * W + x) * 4;
            img.data[d] = SRGB[buf[s]];
            img.data[d + 1] = SRGB[buf[s + 1]];
            img.data[d + 2] = SRGB[buf[s + 2]];
            img.data[d + 3] = buf[s + 3];
          }
        bctx.putImageData(img, 0, 0);
        sctx.clearRect(0, 0, THUMB_W, THUMB_H);
        sctx.drawImage(big, 0, 0, THUMB_W, THUMB_H);
        out[comp.id] = small.toDataURL("image/png");
        return true;
      } finally {
        for (const g of car.children) g.visible = true;
        hidden.forEach((h) => (h.visible = true));
        gl.setRenderTarget(prevTarget);
        gl.setClearColor(prevClear, prevAlpha);
        invalidate();
      }
    };

    // One component per idle callback (a short timeout where requestIdleCallback is missing, e.g. Safari).
    const idle = (f: () => void) => (typeof requestIdleCallback === "function" ? requestIdleCallback(f, { timeout: 500 }) : window.setTimeout(f, 16));
    let k = 0;
    let waits = 0;
    const step = () => {
      if (cancelled) return;
      if (k >= COMPONENTS.length || waits > 600) {
        rt.dispose();
        return;
      }
      if (capture(COMPONENTS[k])) {
        k++;
        onThumbnails({ ...out });
      } else waits++; // car not built yet (slow devices): retry the same component; give up after ~600 idle slots
      idle(step);
    };
    idle(step);
    return () => {
      cancelled = true;
      rt.dispose();
    };
  }, [livery, wings, onThumbnails, store]);
  return null;
}

/** Procedural studio lighting: a generated room environment for reflections (no HDR download), a shadow-casting key light and fills. */
function Studio() {
  const store = useStore();
  useEffect(() => {
    const { gl, scene } = store.getState();
    const pmrem = new PMREMGenerator(gl);
    const room = new RoomEnvironment();
    const env = pmrem.fromScene(room, 0.04).texture;
    scene.environment = env;
    return () => {
      scene.environment = null;
      env.dispose();
      room.traverse((o) => {
        const m = o as { geometry?: { dispose(): void }; material?: { dispose(): void } };
        m.geometry?.dispose();
        m.material?.dispose();
      });
      pmrem.dispose();
    };
  }, [store]);
  return (
    <>
      <hemisphereLight args={["#dfe6ef", "#0e1116", 0.5]} />
      <directionalLight
        position={[2.5, 7, 3.5]}
        intensity={2.2}
        castShadow
        shadow-mapSize={[2048, 2048]}
        shadow-bias={-0.0004}
        shadow-normalBias={0.02}
        shadow-camera-left={-4.5}
        shadow-camera-right={4.5}
        shadow-camera-top={4.5}
        shadow-camera-bottom={-4.5}
        shadow-camera-near={1}
        shadow-camera-far={20}
      />
      <directionalLight position={[-5, 3, -3]} intensity={0.6} />
      <directionalLight position={[0, 2, -6]} intensity={0.4} />
    </>
  );
}

/**
 * Studio floor: a ground disc whose colour fades into the background towards the edge (radial alpha drawn on a small canvas, no
 * texture download), plus a soft shadow catcher. Replaces the grid, whose square edge read as unfinished in the wide showcase.
 */
function Ground() {
  const fade = useMemo(() => {
    if (typeof document === "undefined") return null;
    const c = Object.assign(document.createElement("canvas"), { width: 256, height: 256 });
    const ctx = c.getContext("2d");
    if (!ctx) return null;
    const g = ctx.createRadialGradient(128, 128, 0, 128, 128, 128);
    g.addColorStop(0, "#ffffff");
    g.addColorStop(0.45, "#bfbfbf");
    g.addColorStop(1, "#000000");
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, 256, 256);
    return new CanvasTexture(c);
  }, []);
  useEffect(() => () => fade?.dispose(), [fade]);
  return (
    <group>
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, -0.002, 0]} raycast={() => null}>
        <circleGeometry args={[8, 64]} />
        <meshBasicMaterial color="#1a2029" transparent alphaMap={fade ?? undefined} depthWrite={false} />
      </mesh>
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, -0.001, 0]} receiveShadow raycast={() => null}>
        <circleGeometry args={[5, 64]} />
        <shadowMaterial opacity={0.6} transparent />
      </mesh>
    </group>
  );
}

/**
 * The car viewer's 3D scene. Renders on demand while static; switches to a continuous loop only while something animates every frame
 * (auto-rotate or playing airflow). The explode transition and camera glides request frames themselves.
 */
export default function CarScene(p: CarSceneProps) {
  // The body is built once; a setup change rebuilds only the wings (and disposes the old wing buffers).
  const body = useMemo(() => buildBodyGeometry(), []);
  const wingGeometry = useMemo(() => buildWingGeometry(p.wings), [p.wings]);
  useEffect(() => () => void disposeCarGeometry(body), [body]);
  useEffect(() => () => void disposeCarGeometry(wingGeometry), [wingGeometry]);
  const geometry = useMemo(() => assembleCar(body, wingGeometry), [body, wingGeometry]);
  const initial = useMemo(() => cameraPreset("threeQuarter", 1.6).position, []);
  const exploded = p.explode !== undefined ? p.explode > 0 : p.exploded;
  const continuous = p.autoRotate || (p.aero && p.aeroPlaying && !exploded && !p.cfdSlice);

  return (
    <Canvas
      shadows="soft"
      frameloop={continuous ? "always" : "demand"}
      dpr={[1, 2]}
      gl={{ antialias: true }}
      camera={{ position: [...initial], fov: CAR_FOV, near: 0.05, far: 100 }}
      onCreated={({ gl }) => gl.setClearColor("#090b0e")}
    >
      <Studio />
      <Ground />
      <CarModel
        geometry={geometry}
        livery={p.livery}
        number={p.number}
        selected={p.selected}
        hovered={p.hovered}
        exploded={p.exploded}
        reducedMotion={p.reducedMotion}
        pressure={p.aero && p.pressure}
        onSelect={p.onSelect}
        onHover={p.onHover}
        explode={p.explode}
        modes={p.modes}
        annotate={p.annotate}
      />
      {/* The flow is modelled around the assembled car; drawing it through exploded parts would mislead. */}
      {p.aero && !exploded && !p.cfdSlice && <Airflow settings={p.flow} layers={p.aeroLayers} playing={p.aeroPlaying} focus={p.aeroFocus} />}
      {p.cfdSlice && <CfdSlice result={p.cfdSlice.result} field={p.cfdSlice.field} />}
      <CarCamera preset={p.preset} exploded={exploded} autoRotate={p.autoRotate} reducedMotion={p.reducedMotion} focus={p.focus} insets={p.insets} />
      <ThumbnailCapture livery={p.livery} wings={p.wings} onThumbnails={p.onThumbnails} />
    </Canvas>
  );
}

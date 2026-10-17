"use client";

import { useLayoutEffect, useMemo, useRef, type ComponentRef } from "react";
import { OrbitControls } from "@react-three/drei";
import { useFrame, useStore, useThree } from "@react-three/fiber";
import { Box3, Sphere, Vector3, type Mesh, type PerspectiveCamera } from "three";
import { CAR_TARGET, cameraPreset, fitSphere, zoomLimits } from "@/lib/car/camera";
import type { ComponentId, ViewName } from "@/lib/car/types";

export type CarViewPreset = { name: ViewName; nonce: number };
/** Car Lab: glide to frame one component (as currently drawn, including any explode offset), keeping the viewing angle. */
export type CarFocus = { id: ComponentId; nonce: number };

/** Screen space (px) taken by panels over the full-window canvas; the car is framed in what is left. */
export type FrameInsets = { left: number; right: number };

/**
 * Orbit / pan / zoom around the car. Choosing a preset glides the camera there (or jumps, with reduced motion); touching the controls
 * cancels a glide. Presets are fitted to the free area's aspect and leave room for the exploded car. Arrow keys pan when the canvas has
 * focus. With `insets`, the canvas stays full-window and the view centre glides to the middle of the free area (a projection offset), so
 * opening or closing a side panel never resizes the canvas: resizing it made the car jump.
 */
export function CarCamera({ preset, exploded, autoRotate, reducedMotion, focus, insets }: { preset: CarViewPreset; exploded: boolean; autoRotate: boolean; reducedMotion: boolean; focus?: CarFocus | null; insets?: FrameInsets }) {
  const controls = useRef<ComponentRef<typeof OrbitControls>>(null);
  const store = useStore();
  const size = useThree((s) => s.size);
  const left = insets?.left ?? 0;
  const right = insets?.right ?? 0;
  // The aspect of the free area: presets and zoom limits fit the car there, not to the whole canvas.
  const aspect = Math.max(size.width - left - right, 1) / Math.max(size.height, 1);
  const shift = useRef(0);
  const goal = useRef<{ position: Vector3; target: Vector3 } | null>(null);
  const mounted = useRef(false);
  const interacted = useRef(false);
  const limits = useMemo(() => zoomLimits(aspect), [aspect]);

  useLayoutEffect(() => {
    const { camera, invalidate } = store.getState();
    const p = cameraPreset(preset.name, aspect, exploded);
    goal.current = { position: new Vector3(...p.position), target: new Vector3(...p.target) };
    interacted.current = false;
    // First framing (and reduced motion) jumps; later preset or explode changes glide.
    if (reducedMotion || !mounted.current) {
      mounted.current = true;
      camera.position.copy(goal.current.position);
      controls.current?.target.copy(goal.current.target);
      goal.current = null;
    }
    controls.current?.update();
    invalidate();
    // Aspect is read once per preset: later resizes must not yank a camera the user has moved. Toggling the exploded view is an
    // explicit action, so it re-fits the current view to make room for (or close in on) the parts.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [preset, store, reducedMotion, exploded]);

  // Until the user moves the camera, a change of the free area (window resize, a panel opened or closed) re-fits the current view: a
  // glide, so a panel toggle zooms smoothly instead of snapping (a jump with reduced motion).
  useLayoutEffect(() => {
    if (!mounted.current || interacted.current) return;
    const { camera, invalidate } = store.getState();
    const p = cameraPreset(preset.name, aspect, exploded);
    if (reducedMotion) {
      camera.position.set(...p.position);
      controls.current?.target.set(...p.target);
      controls.current?.update();
    } else goal.current = { position: new Vector3(...p.position), target: new Vector3(...p.target) };
    invalidate();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [aspect]);

  useLayoutEffect(() => {
    if (!focus) return;
    const { camera, scene, invalidate } = store.getState();
    const box = new Box3();
    // Only what is drawn: hidden parts stay mounted (invisible), and must not stretch the framing.
    scene.getObjectByName("car")?.children.forEach((g) => {
      if (g.userData.componentId === focus.id) g.traverseVisible((o) => void ((o as Mesh).isMesh && box.expandByObject(o)));
    });
    const c = controls.current;
    if (box.isEmpty() || !c) return;
    const sphere = box.getBoundingSphere(new Sphere());
    const dir = camera.position.clone().sub(c.target).normalize();
    const position = sphere.center.clone().addScaledVector(dir, fitSphere(sphere.radius, aspect));
    goal.current = { position, target: sphere.center.clone() };
    if (reducedMotion) {
      camera.position.copy(position);
      c.target.copy(sphere.center);
      goal.current = null;
      c.update();
    }
    interacted.current = true; // a focused view is a deliberate framing: resizes must not snap it back to the preset
    invalidate();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [focus]);

  useLayoutEffect(() => {
    const el = store.getState().gl.domElement;
    el.tabIndex = 0;
    controls.current?.listenToKeyEvents(el);
  }, [store]);

  // View centre: glide towards the middle of the free area (re-applied when the canvas size changes, since the offset is in pixels).
  const applied = useRef({ shift: 0, w: 0, h: 0 });
  useFrame(({ camera, invalidate }, dt) => {
    const want = (left - right) / 2;
    shift.current = reducedMotion ? want : shift.current + (want - shift.current) * (1 - Math.exp(-Math.min(dt, 1 / 30) * 9));
    if (Math.abs(want - shift.current) < 0.5) shift.current = want;
    const a = applied.current;
    if (a.shift !== shift.current || a.w !== size.width || a.h !== size.height) {
      const cam = camera as PerspectiveCamera;
      if (shift.current === 0) cam.clearViewOffset();
      else cam.setViewOffset(size.width, size.height, -shift.current, 0, size.width, size.height);
      applied.current = { shift: shift.current, w: size.width, h: size.height };
      invalidate();
    }
    const g = goal.current;
    const c = controls.current;
    if (!g || !c) return;
    const k = 1 - Math.exp(-Math.min(dt, 1 / 30) * 7);
    camera.position.lerp(g.position, k);
    c.target.lerp(g.target, k);
    c.update();
    if (camera.position.distanceTo(g.position) < 0.005 && c.target.distanceTo(g.target) < 0.005) {
      // Land exactly: a leftover millimetre would otherwise leak into the orbit angles.
      camera.position.copy(g.position);
      c.target.copy(g.target);
      c.update();
      goal.current = null;
    }
    invalidate();
  });

  return (
    <OrbitControls
      ref={controls}
      makeDefault
      target={CAR_TARGET as unknown as [number, number, number]}
      enableDamping
      dampingFactor={0.1}
      screenSpacePanning
      minDistance={limits.min}
      maxDistance={limits.max}
      maxPolarAngle={Math.PI / 2 - 0.02}
      autoRotate={autoRotate}
      autoRotateSpeed={0.8}
      onStart={() => {
        goal.current = null;
        interacted.current = true;
      }}
    />
  );
}

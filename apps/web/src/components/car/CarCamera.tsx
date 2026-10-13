"use client";

import { useLayoutEffect, useMemo, useRef, type ComponentRef } from "react";
import { OrbitControls } from "@react-three/drei";
import { useFrame, useStore, useThree } from "@react-three/fiber";
import { Vector3 } from "three";
import { CAR_TARGET, cameraPreset, zoomLimits } from "@/lib/car/camera";
import type { ViewName } from "@/lib/car/types";

export type CarViewPreset = { name: ViewName; nonce: number };

/**
 * Orbit / pan / zoom around the car. Choosing a preset glides the camera there (or jumps, with reduced motion); touching the controls
 * cancels a glide. Presets are fitted to the canvas aspect and leave room for the exploded car. Arrow keys pan when the canvas has focus.
 */
export function CarCamera({ preset, exploded, autoRotate, reducedMotion }: { preset: CarViewPreset; exploded: boolean; autoRotate: boolean; reducedMotion: boolean }) {
  const controls = useRef<ComponentRef<typeof OrbitControls>>(null);
  const store = useStore();
  const aspect = useThree((s) => s.size.width / Math.max(s.size.height, 1));
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

  // Until the user moves the camera, a resize re-fits the current view to the new aspect (renderer and projection are resized by R3F).
  useLayoutEffect(() => {
    if (!mounted.current || interacted.current || goal.current) return;
    const { camera, invalidate } = store.getState();
    const p = cameraPreset(preset.name, aspect, exploded);
    camera.position.set(...p.position);
    controls.current?.target.set(...p.target);
    controls.current?.update();
    invalidate();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [aspect]);

  useLayoutEffect(() => {
    const el = store.getState().gl.domElement;
    el.tabIndex = 0;
    controls.current?.listenToKeyEvents(el);
  }, [store]);

  useFrame(({ camera, invalidate }, dt) => {
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

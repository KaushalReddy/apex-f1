"use client";

import { useCallback, useLayoutEffect, useMemo, useRef, type ComponentRef } from "react";
import { OrbitControls } from "@react-three/drei";
import { useStore, useThree } from "@react-three/fiber";
import { PerspectiveCamera } from "three";
import { dynamicClip, frameCircuit, presetFor, shouldApplyFraming, type ViewName } from "@/lib/circuit/camera";

export type ViewPreset = { name: ViewName; nonce: number };

interface Props {
  /** Centerline in world coordinates; the camera is fitted to it for the current viewport aspect. */
  centerline: Float32Array;
  /** Half the drawn road width: kept inside the frame. */
  marginMeters: number;
  preset: ViewPreset;
}

/**
 * Orbit / pan / zoom camera. The initial view and the "Reset view" / "Top-down" presets are fitted to the circuit's bounds and the
 * canvas aspect (no circuit-specific numbers). After the user touches the camera, viewport resizes no longer move it; choosing a
 * preset always re-applies it (including its field of view). Clip planes follow the current distance. Arrow keys pan when focused.
 * Follow-car cameras are Phase 4.
 */
export function CircuitCamera({ centerline, marginMeters, preset }: Props) {
  const controls = useRef<ComponentRef<typeof OrbitControls>>(null);
  const store = useStore();
  const interacted = useRef(false);
  const appliedNonce = useRef<number | null>(null);
  const aspect = useThree((s) => s.size.width / Math.max(s.size.height, 1));
  const framing = useMemo(() => frameCircuit(centerline, Math.round(aspect * 100) / 100, { marginMeters }), [centerline, aspect, marginMeters]);

  const updateClip = useCallback(() => {
    const c = controls.current;
    const cam = store.getState().camera;
    if (!c || !(cam instanceof PerspectiveCamera)) return;
    const { near, far } = dynamicClip(c.getDistance(), framing.extent);
    cam.near = near;
    cam.far = far;
    cam.updateProjectionMatrix();
  }, [store, framing.extent]);

  useLayoutEffect(() => {
    const presetChanged = appliedNonce.current !== preset.nonce;
    if (presetChanged) {
      appliedNonce.current = preset.nonce;
      interacted.current = false;
    }
    if (!shouldApplyFraming({ interacted: interacted.current, presetChanged })) return;
    const { camera, invalidate } = store.getState();
    const p = presetFor(framing, preset.name);
    camera.position.set(p.position[0], p.position[1], p.position[2]);
    if (camera instanceof PerspectiveCamera) camera.fov = p.fov;
    controls.current?.target.set(p.target[0], p.target[1], p.target[2]);
    camera.lookAt(p.target[0], p.target[1], p.target[2]);
    const clip = dynamicClip(p.distance, framing.extent);
    camera.near = clip.near;
    camera.far = clip.far;
    camera.updateProjectionMatrix();
    controls.current?.update();
    invalidate();
  }, [preset, framing, store]);

  useLayoutEffect(() => {
    const el = store.getState().gl.domElement;
    el.tabIndex = 0;
    controls.current?.listenToKeyEvents(el);
  }, [store]);

  return (
    <OrbitControls
      ref={controls}
      makeDefault
      enableDamping
      dampingFactor={0.12}
      screenSpacePanning
      minDistance={framing.minDistance}
      maxDistance={framing.maxDistance}
      maxPolarAngle={Math.PI / 2 - 0.04}
      onStart={() => {
        interacted.current = true;
      }}
      onChange={updateClip}
    />
  );
}

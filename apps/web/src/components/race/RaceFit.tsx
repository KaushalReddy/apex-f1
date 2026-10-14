"use client";

import { useEffect, useLayoutEffect, useMemo, useRef } from "react";
import { useStore, useThree } from "@react-three/fiber";
import { PerspectiveCamera } from "three";
import { useCircuitTransform } from "@/components/circuit/CircuitFrame";
import { dynamicClip, worldBounds } from "@/lib/circuit/camera";
import { circuitExtentMeters, resolveTrackWidth } from "@/lib/circuit/geometry";
import { centerlineToWorld } from "@/lib/circuit/transform";
import type { CircuitGeometry } from "@/lib/circuit/types";
import { fitInSafeArea, type Insets, type RaceView } from "@/lib/race/fit";

type Controls = { target: { set(x: number, y: number, z: number): void }; update(): void; addEventListener(t: string, fn: () => void): void; removeEventListener(t: string, fn: () => void): void };

/**
 * "Fit circuit" for the race view, layered on the Phase 3 camera without modifying it: on first load, whenever `nonce` changes, and on
 * canvas resize until the user moves the camera, the whole circuit (plus marker and label room) is fitted to the current aspect. It runs
 * after the circuit camera's own framing (it is a later sibling), so the race framing wins. Telemetry updates never move the camera.
 */
const NO_INSETS: Insets = { top: 0, right: 0, bottom: 0, left: 0 };

export function RaceFit({ geometry, nonce, insets = NO_INSETS, view = "overview" }: { geometry: CircuitGeometry; nonce: number; insets?: Insets; view?: RaceView }) {
  const transform = useCircuitTransform();
  const centerline = useMemo(() => centerlineToWorld(geometry, transform), [geometry, transform]);
  const drawn = useMemo(() => resolveTrackWidth(geometry.widthMeters, circuitExtentMeters(geometry.points, geometry.unitMeters)).drawnMeters, [geometry]);
  const extent = useMemo(() => worldBounds(centerline).extent, [centerline]);
  const width = useThree((s) => s.size.width);
  const height = useThree((s) => s.size.height);
  const insetKey = `${insets.top},${insets.right},${insets.bottom},${insets.left}`;
  // OrbitControls register themselves after mount (makeDefault); subscribe to their presence, mutate via the store.
  const hasControls = useThree((s) => !!s.controls);
  const store = useStore();
  const interacted = useRef(false);
  const lastNonce = useRef<number | null>(null);

  useEffect(() => {
    const controls = store.getState().controls as unknown as Controls | null;
    if (!controls) return;
    const onStart = () => {
      interacted.current = true;
    };
    controls.addEventListener("start", onStart);
    return () => controls.removeEventListener("start", onStart);
  }, [hasControls, store]);

  useLayoutEffect(() => {
    const { camera, invalidate } = store.getState();
    const controls = store.getState().controls as unknown as Controls | null;
    if (!controls) return;
    if (width < 2 || height < 2) return; // not laid out yet (e.g. mid fullscreen transition)
    const fitRequested = lastNonce.current !== nonce;
    if (fitRequested) {
      lastNonce.current = nonce;
      interacted.current = false;
    }
    if (!fitRequested && interacted.current) return;
    const p = fitInSafeArea(centerline, { width, height: Math.max(height, 1) }, insets, drawn, view);
    const cam = camera as PerspectiveCamera;
    cam.position.set(p.position[0], p.position[1], p.position[2]);
    if (cam instanceof PerspectiveCamera) {
      cam.fov = p.fov;
      const clip = dynamicClip(p.distance, extent);
      cam.near = clip.near;
      cam.far = clip.far;
      cam.updateProjectionMatrix();
    }
    controls.target.set(p.target[0], p.target[1], p.target[2]);
    camera.lookAt(p.target[0], p.target[1], p.target[2]);
    controls.update();
    invalidate();
    // insets are compared by value (insetKey), not identity.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [nonce, width, height, insetKey, centerline, drawn, extent, hasControls, store, view]);

  return null;
}

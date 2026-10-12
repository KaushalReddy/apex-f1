"use client";

import { useMemo, type ReactNode } from "react";
import { circuitExtentMeters, resolveTrackWidth } from "@/lib/circuit/geometry";
import { worldBounds } from "@/lib/circuit/camera";
import { centerlineToWorld, createWorldTransform } from "@/lib/circuit/transform";
import type { CircuitGeometry } from "@/lib/circuit/types";
import { CircuitEnvironment } from "./CircuitEnvironment";
import { CircuitFrameProvider } from "./CircuitFrame";
import { CircuitTrack } from "./CircuitTrack";

/** Everything derived from a geometry document: the shared transform, world-space centerline, bounds and the drawn road width. */
export function useCircuitModel(geometry: CircuitGeometry) {
  const transform = useMemo(() => createWorldTransform(geometry), [geometry]);
  const centerline = useMemo(() => centerlineToWorld(geometry, transform), [geometry, transform]);
  const bounds = useMemo(() => worldBounds(centerline), [centerline]);
  const trackWidth = useMemo(() => resolveTrackWidth(geometry.widthMeters, circuitExtentMeters(geometry.points, geometry.unitMeters)), [geometry]);
  return { transform, centerline, bounds, trackWidth };
}

export type CircuitModel = ReturnType<typeof useCircuitModel>;

/** Environment + track inside the shared coordinate frame. Camera-free so it can be tested headlessly. */
export function CircuitWorld({ geometry, model, children }: { geometry: CircuitGeometry; model: CircuitModel; children?: ReactNode }) {
  return (
    <CircuitFrameProvider value={model.transform}>
      <CircuitEnvironment radius={model.bounds.radius} />
      <CircuitTrack
        centerline={model.centerline}
        closed={geometry.closed}
        widthMeters={model.trackWidth.drawnMeters}
        startFinish={geometry.derivation.startFinishAtIndex0 === true}
      />
      {children}
    </CircuitFrameProvider>
  );
}

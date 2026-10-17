import type { CircuitGeometry } from "@/lib/circuit/types";
import { centerlineToWorld, createWorldTransform } from "@/lib/circuit/transform";
import { createTrackPath } from "@/lib/race/track";
import { parseReplay, type ReplayDataset } from "./dataset";
import { computeProgress } from "./model";

export interface LoadedReplay {
  ds: ReplayDataset;
  progress: Float64Array[];
}

/** OpenF1 location -> lap fraction on the circuit centerline, in the same world frame the race scene builds. */
export function projector(geometry: CircuitGeometry) {
  const transform = createWorldTransform(geometry);
  const path = createTrackPath(centerlineToWorld(geometry, transform));
  return (x: number, y: number, hint: number | null) => {
    const w = transform.toWorld(x, y, transform.origin[2]);
    return path.project(w[0], w[2], hint);
  };
}

/** Fetch, validate and index one race (the work the replay worker does; also the fallback without workers). */
export async function loadReplay(url: string, geometry: CircuitGeometry, signal?: AbortSignal): Promise<LoadedReplay> {
  const r = await fetch(url, { signal });
  if (!r.ok) throw new Error(`the replay file answered HTTP ${r.status}`);
  const parsed = parseReplay(await r.json());
  if (!parsed.ok) throw new Error(`the replay file is invalid (${parsed.error})`);
  if (parsed.value.coordinateSystem !== geometry.coordinateSystem) throw new Error("the replay and the circuit layout use different coordinate systems");
  return { ds: parsed.value, progress: computeProgress(parsed.value, projector(geometry)) };
}

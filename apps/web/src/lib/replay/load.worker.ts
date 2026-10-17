/// <reference lib="webworker" />
import type { CircuitGeometry } from "@/lib/circuit/types";
import { loadReplay } from "./loadReplay";

/** Replay loader worker: fetch + validate + place positions on the centerline, then hand the result to the page (see loadReplayOffThread). */
self.onmessage = async (e: MessageEvent<{ url: string; geometry: CircuitGeometry }>) => {
  try {
    const value = await loadReplay(e.data.url, e.data.geometry);
    (self as unknown as Worker).postMessage({ ok: true, value }, value.progress.map((a) => a.buffer));
  } catch (err) {
    (self as unknown as Worker).postMessage({ ok: false, error: err instanceof Error ? err.message : "the replay could not be loaded" });
  }
};

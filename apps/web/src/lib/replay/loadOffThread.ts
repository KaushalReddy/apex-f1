import type { CircuitGeometry } from "@/lib/circuit/types";
import { loadReplay, type LoadedReplay } from "./loadReplay";

// Kept apart from loadReplay.ts: the worker imports that module, and a module that both starts the worker and is imported by it makes the
// bundler nest workers without end (the production build hung).
/**
 * Loads a race off the main thread when the browser supports module workers (parsing and placing ~120k positions froze the page for
 * 0.5 s on a fast desktop, ~2 s on a phone-class CPU); otherwise on the main thread. The progress arrays are transferred, not copied.
 */
export function loadReplayOffThread(url: string, geometry: CircuitGeometry, signal: AbortSignal): Promise<LoadedReplay> {
  const abs = new URL(url, window.location.href).href;
  if (typeof Worker === "undefined") return loadReplay(abs, geometry, signal);
  let worker: Worker;
  try {
    worker = new Worker(new URL("./load.worker.ts", import.meta.url), { type: "module" });
  } catch {
    return loadReplay(abs, geometry, signal);
  }
  return new Promise<LoadedReplay>((resolve, reject) => {
    const done = () => worker.terminate();
    signal.addEventListener("abort", () => {
      done();
      reject(new DOMException("aborted", "AbortError"));
    });
    worker.onmessage = (e: MessageEvent<{ ok: true; value: LoadedReplay } | { ok: false; error: string }>) => {
      done();
      if (e.data.ok) resolve(e.data.value);
      else reject(new Error(e.data.error));
    };
    worker.onerror = () => {
      // The worker could not start (e.g. blocked): fall back to the main thread.
      done();
      loadReplay(abs, geometry, signal).then(resolve, reject);
    };
    worker.postMessage({ url: abs, geometry });
  });
}

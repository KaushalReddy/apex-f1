import { parseSessionTelemetry } from "./parse";
import type { SessionTelemetry } from "./types";

/**
 * Browser-side loader for one session's fastest-lap telemetry (from this site's /api/telemetry/<session>). One request per session per
 * page: switching drivers, laps or channels reuses it. Responses are validated again here (a trust boundary for the browser).
 */
const cache = new Map<number, Promise<SessionTelemetry>>();

export function fetchSessionTelemetry(sessionKey: number): Promise<SessionTelemetry> {
  let p = cache.get(sessionKey);
  if (!p) {
    p = fetch(`/api/telemetry/${sessionKey}`)
      .then((r) => {
        if (!r.ok) throw new Error(r.status === 404 ? "no car telemetry is available for this race" : `the telemetry request answered HTTP ${r.status}`);
        return r.json();
      })
      .then((raw: unknown) => {
        const v = parseSessionTelemetry({ schema: "apex-f1/lap-telemetry@1", ...(raw as object) });
        if (!v.ok) throw new Error(`the telemetry is invalid (${v.error})`);
        return v.value;
      });
    p.catch(() => cache.delete(sessionKey)); // a failure is retried next time, not cached
    cache.set(sessionKey, p);
  }
  return p;
}

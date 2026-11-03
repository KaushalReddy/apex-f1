import type { LiveDiagnostics, LiveSnapshot } from "./live";

/** The Live Race Health panel and its metadata exist only on a development server (`next dev`); never in a production build. */
export const devDiagnosticsEnabled = (nodeEnv: string | undefined = process.env.NODE_ENV) => nodeEnv === "development";

/** /api/live's answer: in development it carries the feed's read-only diagnostics; in production it is the snapshot unchanged. */
export function withDiagnostics(s: LiveSnapshot, feed: { diagnostics(): LiveDiagnostics }, nodeEnv: string | undefined): LiveSnapshot {
  return devDiagnosticsEnabled(nodeEnv) ? { ...s, diag: feed.diagnostics() } : s;
}

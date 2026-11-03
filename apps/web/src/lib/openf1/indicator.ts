import type { LiveSnapshot } from "./live";
import type { PollUpdate } from "./poller";

export type IndicatorState = "checking" | "live" | "upcoming" | "ended" | "none" | "unavailable";

/**
 * What the site header says about live timing, from the same /api/live state the Live page uses. `label` is the full text, `short` fits
 * a phone header. Times are formatted by the caller (`at`), so this stays pure and testable.
 */
export function indicator(u: PollUpdate<LiveSnapshot> | null, now: number, at: (iso: string) => string): { state: IndicatorState; label: string; short: string } {
  const s = u?.data;
  if (!s) return u?.error ? { state: "unavailable", label: "Live timing unavailable", short: "Live" } : { state: "checking", label: "Live timing", short: "Live" };
  const name = (x: { event: string | null; name: string }) => `${x.event ? `${x.event} ` : ""}${x.name}`;
  if (s.status === "live" && s.session) {
    const start = Date.parse(s.session.start);
    const end = Date.parse(s.session.end);
    if (now < start) return { state: "upcoming", label: `${name(s.session)} at ${at(s.session.start)}`, short: "Soon" };
    if (now > end) return { state: "ended", label: `${name(s.session)} ended`, short: "Ended" };
    return { state: "live", label: `Live: ${name(s.session)}`, short: "Live" };
  }
  // No subscription, or OpenF1 refused the login: say so instead of implying nothing is on.
  if (s.status === "unavailable" || s.status === "error") return { state: "unavailable", label: "Live timing unavailable", short: "Live" };
  if (s.next) return { state: "upcoming", label: `Next: ${name(s.next)}, ${at(s.next.start)}`, short: "Next" };
  return { state: "none", label: "No session on track", short: "Live" };
}

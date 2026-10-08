import Link from "next/link";
import { StatusDot } from "@/components/ui/status-dot";
import type { SessionStatus } from "@/domain/session";

const copy: Record<SessionStatus, { label: string; tone: "neutral" | "accent" | "info" }> = {
  none: { label: "No live session", tone: "neutral" },
  live: { label: "Live", tone: "accent" },
  replay: { label: "Replay", tone: "info" },
};

/** Header slot for LIVE / REPLAY mode. Always "none" until the live pipeline exists (Phase 5). */
export function LiveIndicator({ status = "none" }: { status?: SessionStatus }) {
  const { label, tone } = copy[status];
  return (
    <Link
      href="/live"
      className="inline-flex items-center gap-2 rounded-md border border-line px-2.5 py-1.5 font-mono text-[0.6875rem] uppercase tracking-[0.12em] text-muted hover:text-fg"
    >
      <StatusDot tone={tone} pulse={status === "live"} />
      {label}
    </Link>
  );
}

import Link from "next/link";
import { StatusDot } from "@/components/ui/status-dot";
import type { SessionStatus } from "@/domain/session";

const copy: Record<SessionStatus, { label: string; tone: "neutral" | "accent" | "info" }> = {
  none: { label: "No live session", tone: "neutral" },
  live: { label: "Live", tone: "accent" },
  replay: { label: "Replay", tone: "info" },
};

/** Header slot for LIVE / REPLAY mode. Always "none" until the live pipeline exists (Phase 5). Text, not just a dot, carries the state. */
export function LiveIndicator({ status = "none" }: { status?: SessionStatus }) {
  const { label, tone } = copy[status];
  return (
    <Link
      href="/live"
      className="motion-interactive inline-flex h-9 items-center gap-2 rounded-md border border-line px-3 text-xs font-medium text-muted hover:border-line-strong hover:bg-surface-2 hover:text-fg"
    >
      <StatusDot tone={tone} pulse={status === "live"} />
      {label}
    </Link>
  );
}

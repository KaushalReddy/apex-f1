"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { StatusDot } from "@/components/ui/status-dot";
import { indicator, type IndicatorState } from "@/lib/openf1/indicator";
import { useLiveState } from "@/lib/openf1/liveStore";
import { sessionStart } from "@/lib/openf1/time";

const TONE: Record<IndicatorState, "neutral" | "accent" | "info"> = { checking: "neutral", live: "accent", upcoming: "info", ended: "neutral", none: "neutral", unavailable: "neutral" };

/**
 * Header slot: live-timing state from the tab's shared /api/live poll (the same state the Live page shows; no request of its own).
 * Text, not just the dot, carries the state; on phones a short word, with the full text as the accessible name.
 */
export function LiveIndicator() {
  const u = useLiveState();
  // The clock starts after hydration (the server has no viewer clock) and ticks so "upcoming" becomes "live" and "ended" on time.
  const [now, setNow] = useState<number | null>(null);
  useEffect(() => {
    const tick = () => setNow(Date.now());
    const first = setTimeout(tick, 0);
    const id = setInterval(tick, 30_000);
    return () => {
      clearTimeout(first);
      clearInterval(id);
    };
  }, []);
  const { state, label, short } = indicator(now == null ? null : u, now ?? 0, sessionStart);
  return (
    <Link
      href="/live"
      aria-label={label}
      title={label}
      className="motion-interactive inline-flex h-9 min-w-0 max-w-[22rem] items-center gap-2 rounded-md border border-line px-3 text-xs font-medium text-muted hover:border-line-strong hover:bg-surface-2 hover:text-fg"
    >
      <StatusDot tone={TONE[state]} pulse={state === "live"} />
      <span aria-hidden className="truncate sm:hidden">
        {short}
      </span>
      <span aria-hidden className="hidden truncate sm:inline">
        {label}
      </span>
    </Link>
  );
}

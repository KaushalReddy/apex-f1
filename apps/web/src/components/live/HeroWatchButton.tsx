"use client";

import { useEffect, useState } from "react";
import { ButtonLink } from "@/components/ui/button";
import { indicator } from "@/lib/openf1/indicator";
import { useLiveState } from "@/lib/openf1/liveStore";
import { sessionStart } from "@/lib/openf1/time";

/**
 * Home hero's main action: "Watch live" while a session is on track (same state as the header's live indicator, from the tab's shared
 * /api/live poll, no request of its own), otherwise the latest race replay.
 */
export function HeroWatchButton({ href, label }: { href: string; label: string }) {
  const u = useLiveState();
  // Clock starts after hydration so the server render (no viewer clock) and the first client render match; ticks so the button flips on time.
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
  const live = now != null && u?.data?.session && indicator(u, now, sessionStart).state === "live" ? u.data.session : null;
  if (!live) return <ButtonLink href={href}>{label}</ButtonLink>;
  return (
    <ButtonLink href="/live">
      <span aria-hidden className="size-2 rounded-full bg-accent-fg motion-safe:animate-pulse" />
      Watch live: {live.event ? `${live.event} ` : ""}
      {live.name}
    </ButtonLink>
  );
}

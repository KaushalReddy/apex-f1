"use client";

import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { useLiveState } from "@/lib/openf1/liveStore";

/**
 * Live page: when the session on track changes (one starts, ends, or the next replaces it) while the page is open, re-renders the page on
 * the server (router.refresh: no full reload; the 3D view keeps its camera when the circuit is the same) and says so briefly. Each session
 * is tried once, so a session the page cannot draw (e.g. a circuit without a layout) never causes a refresh loop.
 */
export function LiveSessionWatch({ following }: { following: number | null }) {
  const router = useRouter();
  const u = useLiveState();
  const tried = useRef(new Set<number | null>([following]));
  const [note, setNote] = useState<string | null>(null);
  const s = u?.data;
  const current = s?.status === "live" ? s.session : null;
  const key = s ? (current?.key ?? null) : following;

  useEffect(() => {
    if (key === following || tried.current.has(key)) return;
    tried.current.add(key);
    const text = current ? `${current.event ?? "A session"} ${current.name} is on track: following it now.` : "The live session has ended: showing the latest recorded race.";
    void Promise.resolve().then(() => setNote(text));
    router.refresh();
  }, [key, following, current, router]);

  useEffect(() => {
    if (!note) return;
    const id = setTimeout(() => setNote(null), 8000);
    return () => clearTimeout(id);
  }, [note]);

  return (
    // Above the replay playback bar (the recorded-race view); the live view has none.
    <div aria-live="polite" className="pointer-events-none fixed inset-x-0 bottom-36 z-[80] flex justify-center px-3">
      {note && <p className="pointer-events-auto rounded-md border border-line bg-surface/95 px-3 py-2 text-xs text-fg shadow-2 backdrop-blur">{note}</p>}
    </div>
  );
}

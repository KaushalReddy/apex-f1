"use client";

import { Button } from "@/components/ui/button";
import { EngineerChat } from "./EngineerChat";

const SUGGESTIONS = ["What has happened so far?", "Who is fastest right now?", "How are the tyre strategies playing out?", "Why did the leader change?"] as const;

/** The Race Engineer inside the replay: it knows the race only up to the replay moment when each question is asked, and links seek. */
export function EngineerPanel({ sessionKey, t, onSeek, onClose }: { sessionKey: number; t: number; onSeek: (t: number) => void; onClose: () => void }) {
  return (
    <section aria-labelledby="eng-heading" className="flex min-h-0 flex-1 flex-col">
      <div className="flex items-center justify-between gap-2 border-b border-white/10 px-3 py-2">
        <h2 id="eng-heading" className="eyebrow whitespace-nowrap">
          Race engineer <span className="ml-1 normal-case tracking-normal text-warning">AI</span>
        </h2>
        <Button size="sm" variant="ghost" className="h-7 px-2 text-xs" onClick={onClose}>
          Close
        </Button>
      </div>
      <p className="px-3 pt-2 text-[11px] text-subtle">Knows the race only up to the replay moment when you ask, so no spoilers. Select a linked moment to jump there.</p>
      <EngineerChat sessionKey={sessionKey} until={t} suggestions={SUGGESTIONS} onMoment={onSeek} compact />
    </section>
  );
}

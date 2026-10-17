"use client";

import { EngineerChat } from "./EngineerChat";

const SUGGESTIONS = ["How was this race won?", "Who gained the most places, and how?", "Which tyre strategy worked best?", "What happened under the Safety Car or VSC?", "Did the weather play a part?"] as const;

/** The page's chat for one race (whole race known). Moments link into the replay when the race has one. */
export function EngineerPage({ sessionKey, raceName, hasReplay }: { sessionKey: number; raceName: string; hasReplay: boolean }) {
  return (
    <section aria-label={`Race engineer: ${raceName}`} className="flex min-h-[28rem] flex-col rounded-lg border border-line bg-surface p-3 sm:p-4">
      <EngineerChat sessionKey={sessionKey} suggestions={SUGGESTIONS} momentHref={hasReplay ? (t) => `/replay/${sessionKey}#t=${Math.round(t)}` : null} />
    </section>
  );
}

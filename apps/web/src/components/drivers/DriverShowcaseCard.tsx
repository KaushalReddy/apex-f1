import Image from "next/image";
import Link from "next/link";
import { HALFTONE, SHEEN } from "@/components/teams/TeamShowcaseCard";
import type { DirectoryEntry } from "@/lib/drivers/views";
import { cardShade } from "@/lib/teams/registry";

/**
 * Large driver card, the companion of the team card: the same team-colour ground (darkened for white text), halftone and sheen, hover lift
 * and focus ring. Three zones: text on the left (name, team, car number, then the season's numbers), the car number as a large outline in the
 * middle, the supplied portrait on the right; none overlaps another. The whole card is one link to the profile, named by its visible text
 * (portrait and outline number are decorative).
 */
export function DriverShowcaseCard({ d, portrait, priority }: { d: DirectoryEntry; portrait: string | null; priority?: boolean }) {
  const parts = d.name.split(" ");
  const last = parts.length > 1 ? parts.pop()! : d.name;
  const first = parts.length ? parts.join(" ") : null;
  const stats = [d.championshipPosition != null ? `P${d.championshipPosition}` : null, d.championshipPoints != null ? `${d.championshipPoints} pts` : null, d.wins ? `${d.wins} win${d.wins === 1 ? "" : "s"}` : null].filter(Boolean);
  return (
    <Link
      href={`/drivers/${d.slug}`}
      className="group relative isolate flex aspect-[16/10] [container-type:inline-size] min-h-[12.5rem] overflow-hidden rounded-xl text-white outline-none ring-offset-2 ring-offset-bg transition-transform duration-[var(--duration-fast)] focus-visible:ring-2 focus-visible:ring-accent motion-safe:hover:-translate-y-0.5 sm:aspect-[16/9]"
      style={{ backgroundColor: cardShade(d.teamColour) }}
    >
      <span aria-hidden="true" className="absolute inset-0 -z-10" style={HALFTONE} />
      <span aria-hidden="true" className={`absolute inset-0 -z-10 ${SHEEN}`} />
      {/* The car number as a large outline in the middle zone, between the text and the portrait, tilted and leaning forward like a race
          number (decorative; it is also in the text). */}
      {d.number != null && (
        <span
          aria-hidden="true"
          className="pointer-events-none absolute left-[52%] top-1/2 -z-10 -translate-x-1/2 -translate-y-1/2 select-none"
        >
          <span className="block -rotate-[7deg] -skew-x-[10deg] font-display text-[clamp(4.75rem,26cqw,13.5rem)] font-semibold leading-none text-[rgb(255_255_255/0.06)] [-webkit-text-stroke:2.5px_rgb(255_255_255/0.34)]">
            {d.number}
          </span>
        </span>
      )}
      {portrait && (
        // Right zone: the full-length photo from the head down, cropped below; the face is never cut.
        <span aria-hidden="true" className="absolute bottom-0 right-[2%] top-[7%] w-[34%] overflow-hidden">
          <Image
            src={portrait}
            alt=""
            fill
            sizes="(min-width: 1280px) 230px, (min-width: 768px) 18vw, 34vw"
            priority={priority}
            className="object-cover object-top drop-shadow-[0_12px_18px_rgb(0_0_0/0.35)] transition-transform duration-[var(--duration-slow)] ease-[var(--ease-apex)] motion-safe:group-hover:-translate-y-1"
          />
        </span>
      )}
      {/* Sizes follow the card's own width (container units), so the longest surname fits its zone at every card size. */}
      <div className="relative flex w-[40%] min-w-0 flex-col justify-between p-[clamp(1rem,4.5cqw,1.5rem)]">
        <div>
          <h2 className="leading-none">
            {first && <span className="block text-base font-medium text-white/85 sm:text-lg">{first}</span>}
            <span className="mt-1 block truncate font-display text-[clamp(1.2rem,6cqw,2.5rem)] font-semibold uppercase tracking-[0.02em]">{last}</span>
          </h2>
          <p className="mt-2 truncate text-sm text-white/80 sm:text-base">{d.team ?? "Team not published"}</p>
          {d.number != null && <p className="mt-3 font-display text-2xl font-semibold tabular-nums tracking-[0.04em] sm:text-3xl">#{d.number}</p>}
        </div>
        {stats.length > 0 && <p className="text-xs font-medium tabular-nums text-white/80 sm:text-sm">{stats.join(" · ")}</p>}
      </div>
    </Link>
  );
}

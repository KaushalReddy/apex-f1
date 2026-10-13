import Image from "next/image";
import Link from "next/link";
import type { TeamCardData } from "@/lib/teams/views";

/** Halftone dots, densest at the bottom where the car sits (decorative). */
const HALFTONE = {
  backgroundImage: "radial-gradient(rgb(255 255 255 / 0.22) 1px, transparent 1.6px)",
  backgroundSize: "9px 9px",
  maskImage: "linear-gradient(to top, black 5%, transparent 75%)",
  WebkitMaskImage: "linear-gradient(to top, black 5%, transparent 75%)",
} as const;

/**
 * Large team card for the directory: name and line-up top-left, identity mark top-right, the car across the bottom. The whole card is one
 * link (no nested controls). Background is the team colour darkened just enough for white text (lib/teams/registry cardShade).
 */
export function TeamShowcaseCard({ t, season, priority }: { t: TeamCardData; season: number; priority?: boolean }) {
  const standing = t.position != null ? `P${t.position} · ${t.points ?? "—"} pts` : null;
  return (
    <Link
      href={`/teams/${t.slug}?season=${season}`}
      aria-label={`${t.name}${t.racedAs ? ` (raced as ${t.racedAs})` : ""}, ${season}${standing ? `, ${standing}` : ""}. Drivers: ${t.drivers.map((d) => d.name).join(" and ")}`}
      className="group relative isolate flex aspect-[16/10] flex-col overflow-hidden rounded-xl text-white outline-none ring-offset-2 ring-offset-bg transition-transform duration-[var(--duration-fast)] focus-visible:ring-2 focus-visible:ring-accent motion-safe:hover:-translate-y-0.5 sm:aspect-[16/9]"
      style={{ backgroundColor: t.shade }}
    >
      <span aria-hidden="true" className="absolute inset-0 -z-10" style={HALFTONE} />
      <span aria-hidden="true" className="absolute inset-0 -z-10 bg-[linear-gradient(140deg,rgb(255_255_255/0.10),transparent_45%,rgb(0_0_0/0.28))]" />

      <div className="flex items-start justify-between gap-3 p-4 sm:p-6">
        <div className="min-w-0">
          <h2 className="font-display text-2xl font-semibold leading-none tracking-[0.01em] sm:text-3xl lg:text-4xl">{t.name}</h2>
          {t.racedAs && <p className="mt-1 text-xs text-white/80">Raced as {t.racedAs} in {season}</p>}
          <ul className="mt-2.5 flex flex-wrap gap-x-4 gap-y-1 text-sm" aria-hidden="true">
            {t.drivers.map((d) => (
              <li key={d.acronym} className="flex items-baseline gap-1.5">
                <span className="font-semibold tracking-[0.04em]">{d.acronym}</span>
                <span className="hidden text-white/80 min-[420px]:inline">{d.name}</span>
              </li>
            ))}
            {t.otherDrivers > 0 && <li className="text-white/70">+{t.otherDrivers}</li>}
          </ul>
          {standing && (
            <p className="mt-2 text-xs font-medium tabular-nums text-white/80" aria-hidden="true">
              {standing}
              {t.wins > 0 && ` · ${t.wins} win${t.wins === 1 ? "" : "s"}`}
            </p>
          )}
        </div>
        <span
          aria-hidden="true"
          className="grid size-11 shrink-0 place-items-center rounded-full border border-white/40 bg-black/20 font-display text-sm font-semibold tracking-[0.06em] sm:size-14 sm:text-base"
        >
          {t.code}
        </span>
      </div>

      <div className="relative mt-auto px-[3%] pb-[4%]">
        {t.image ? (
          <Image
            src={t.image.src}
            width={t.image.width}
            height={t.image.height}
            alt=""
            priority={priority}
            sizes="(min-width: 1280px) 600px, (min-width: 768px) 46vw, 94vw"
            className="h-auto w-full object-contain drop-shadow-[0_10px_14px_rgb(0_0_0/0.45)] transition-transform duration-[var(--duration-slow)] ease-[var(--ease-apex)] motion-safe:group-hover:translate-x-1.5"
          />
        ) : (
          <p aria-hidden="true" className="pb-4 font-display text-6xl font-semibold text-white/15">
            {t.code}
          </p>
        )}
      </div>
    </Link>
  );
}

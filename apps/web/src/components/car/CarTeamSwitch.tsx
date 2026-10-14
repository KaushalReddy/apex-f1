"use client";

import { useRouter } from "next/navigation";

/** Team picker for the car pages: keeps the current view (showcase or Lab) and moves to the chosen team's car. */
export function CarTeamSwitch({ teams, current, lab }: { teams: ReadonlyArray<{ slug: string; name: string }>; current: string; lab?: boolean }) {
  const router = useRouter();
  return (
    <label className="flex items-center gap-2 text-sm">
      <span className="text-muted">Team</span>
      <select
        value={current}
        onChange={(e) => router.push(`/cars/${e.target.value}${lab ? "/lab" : ""}`)}
        className="h-9 rounded-md border border-line-strong bg-surface-2 px-2 text-fg"
      >
        {teams.map((t) => (
          <option key={t.slug} value={t.slug}>
            {t.name}
          </option>
        ))}
      </select>
    </label>
  );
}

import Link from "next/link";
import { CARD_LINK, CardArrow } from "@/components/ui/card-arrow";
import { driversOf, type DemoTeam } from "@/domain/demo";

/** `drivers` overrides the race-demo line-up (e.g. the car pages pass every team's current drivers). */
export function TeamCard({ team, base = "/teams", drivers = driversOf(team.slug) }: { team: DemoTeam; base?: "/teams" | "/cars"; drivers?: ReadonlyArray<{ name: string }> }) {
  return (
    <Link href={`${base}/${team.slug}`} className={`${CARD_LINK} relative overflow-hidden pl-6`}>
      <span aria-hidden="true" className="absolute inset-y-0 left-0 w-1" style={{ backgroundColor: team.color }} />
      <div className="flex items-start justify-between gap-2">
        <p className="text-base font-medium">{team.name}</p>
        <CardArrow />
      </div>
      {drivers.length > 0 && <p className="mt-2 text-sm text-muted">{drivers.map((d) => d.name).join(" · ")}</p>}
    </Link>
  );
}

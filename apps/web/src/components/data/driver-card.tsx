import Link from "next/link";
import { findTeam, type DemoDriver } from "@/domain/demo";
import { TeamMarker } from "./team-marker";

export function DriverCard({ driver }: { driver: DemoDriver }) {
  const team = findTeam(driver.teamSlug);
  return (
    <Link
      href={`/drivers/${driver.slug}`}
      className="group block rounded-lg border border-line bg-surface p-5 shadow-1 transition-colors hover:border-line-strong hover:bg-surface-2"
    >
      <p className="font-mono text-3xl font-semibold tracking-wider text-fg">{driver.code}</p>
      <p className="mt-3 text-base font-medium group-hover:text-accent-strong">{driver.name}</p>
      {team && (
        <p className="mt-1 flex items-center gap-2 text-sm text-muted">
          <TeamMarker color={team.color} />
          {team.name}
        </p>
      )}
    </Link>
  );
}

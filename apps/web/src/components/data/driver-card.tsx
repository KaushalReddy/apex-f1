import Link from "next/link";
import { CARD_LINK, CardArrow } from "@/components/ui/card-arrow";
import { findTeam, type DemoDriver } from "@/domain/demo";
import { TeamMarker } from "./team-marker";

export function DriverCard({ driver }: { driver: DemoDriver }) {
  const team = findTeam(driver.teamSlug);
  return (
    <Link href={`/drivers/${driver.slug}`} className={CARD_LINK}>
      <div className="flex items-start justify-between gap-2">
        <p className="font-display text-4xl font-semibold leading-none tracking-[0.04em] text-fg">{driver.code}</p>
        <CardArrow />
      </div>
      <p className="mt-4 text-base font-medium">{driver.name}</p>
      {team && (
        <p className="mt-1.5 flex items-center gap-2 text-sm text-muted">
          <TeamMarker color={team.color} />
          {team.name}
        </p>
      )}
    </Link>
  );
}

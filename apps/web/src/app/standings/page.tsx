import Link from "next/link";
import { Badge } from "@/components/ui/badge";
import { ButtonLink } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";
import { PageContainer } from "@/components/ui/page-container";
import { PageHeader } from "@/components/ui/page-header";
import { getNavItem } from "@/domain/navigation";

export const metadata = { title: "Standings" };

/**
 * Standings are an unfinished feature, not a loading table: no provider feeds championship data yet. The page says so plainly
 * instead of showing placeholder rows, which read as an endless skeleton.
 */
export default function StandingsPage() {
  const { phase } = getNavItem("/standings");
  return (
    <PageContainer>
      <PageHeader
        eyebrow="Standings"
        title="Championship standings"
        description="Driver and constructor tables will appear here once a championship data source is connected."
        badges={<Badge tone="info">Planned · Phase {phase}</Badge>}
      />
      <div className="grid gap-4 lg:grid-cols-2">
        <section aria-labelledby="drivers-standings">
          <h2 id="drivers-standings" className="sr-only">
            Drivers&apos; championship
          </h2>
          <EmptyState
            headingLevel="h3"
            title="Drivers' championship: no data connected"
            status="Not available"
            statusTone="warning"
            action={
              <ButtonLink href="/drivers" variant="secondary" size="sm">
                Browse drivers
              </ButtonLink>
            }
          >
            No provider is configured for championship points, so no positions are shown. No positions or points are estimated or invented.
          </EmptyState>
        </section>
        <section aria-labelledby="constructors-standings">
          <h2 id="constructors-standings" className="sr-only">
            Constructors&apos; championship
          </h2>
          <EmptyState
            headingLevel="h3"
            title="Constructors' championship: no data connected"
            status="Not available"
            statusTone="warning"
            action={
              <ButtonLink href="/teams" variant="secondary" size="sm">
                Browse teams
              </ButtonLink>
            }
          >
            Constructor tables follow the driver standings. Team pages already exist as a static preview of the layout.
          </EmptyState>
        </section>
      </div>
      <p className="mt-6 text-sm text-muted">
        Session data that is available today (laps, positions, weather) comes from imported races; see{" "}
        <Link href="/analysis" className="text-fg underline decoration-line-strong underline-offset-4 hover:decoration-accent">
          the analysis tools
        </Link>
        .
      </p>
    </PageContainer>
  );
}

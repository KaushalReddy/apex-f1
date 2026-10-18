import { notFound } from "next/navigation";
import { TeamProfile } from "@/components/teams/TeamProfile";
import { ButtonLink } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";
import { PageContainer } from "@/components/ui/page-container";
import { PageHeader } from "@/components/ui/page-header";
import { loadSeasons } from "@/lib/drivers/load";
import { findTeamBySlug, TEAMS } from "@/lib/teams/registry";
import { teamProfile } from "@/lib/teams/views";

// Race data can change after the build (tools/openf1-sync writes DATA_DIR): rebuilt in the background at most every 15 minutes, and at once
// when the sync worker calls /api/revalidate.
export const revalidate = 900;

export const dynamicParams = false;
export const generateStaticParams = () => TEAMS.map((t) => ({ team: t.slug }));

type Props = {
  params: Promise<{ team: string }>;
};

export async function generateMetadata({ params }: Props) {
  return { title: findTeamBySlug((await params).team)?.name ?? "Team" };
}

export default async function TeamPage({ params }: Props) {
  const slug = (await params).team;
  if (!findTeamBySlug(slug)) notFound();
  const { seasons } = await loadSeasons();
  const profile = teamProfile(seasons, slug)!;
  return (
    <PageContainer>
      {profile.seasons.length ? (
        <TeamProfile profile={profile} />
      ) : (
        <>
          <PageHeader eyebrow="Team" title={profile.team.name} />
          <EmptyState
            title="No results in this dataset"
            status="Not available"
            statusTone="warning"
            headingLevel="h2"
            action={
              <ButtonLink href="/teams" variant="secondary" size="sm">
                All teams
              </ButtonLink>
            }
          >
            The exported seasons have no race entries for this team, so no
            line-up, points or results are shown.
          </EmptyState>
        </>
      )}
    </PageContainer>
  );
}

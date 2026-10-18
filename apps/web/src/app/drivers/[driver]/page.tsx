import { notFound } from "next/navigation";
import { DriverProfile } from "@/components/drivers/DriverProfile";
import { ComingSoon } from "@/components/ui/coming-soon";
import { PageContainer } from "@/components/ui/page-container";
import { DEMO_DRIVERS, findDriver, findTeam } from "@/domain/demo";
import { driverRegistry } from "@/lib/drivers/identity";
import { loadSeasons } from "@/lib/drivers/load";
import { profile } from "@/lib/drivers/views";

// Race data can change after the build (tools/openf1-sync writes DATA_DIR): rebuilt in the background at most every 15 minutes, and at once
// when the sync worker calls /api/revalidate.
export const revalidate = 900;

// Races and drivers synced after the build render on demand; unknown ones still 404 (notFound below).
export const dynamicParams = true;

/** Every driver in the exported seasons, plus the project's existing slugs (so their links never break even without a dataset). */
export async function generateStaticParams() {
  const { seasons } = await loadSeasons();
  const slugs = new Set([...driverRegistry(seasons).map((d) => d.slug), ...DEMO_DRIVERS.map((d) => d.slug)]);
  return [...slugs].map((driver) => ({ driver }));
}

type Props = { params: Promise<{ driver: string }> };

export async function generateMetadata({ params }: Props) {
  const slug = (await params).driver;
  const { seasons } = await loadSeasons();
  const name = driverRegistry(seasons).find((d) => d.slug === slug)?.name ?? findDriver(slug)?.name;
  // An unknown driver is a 404 before anything is sent (metadata resolves first: next.config htmlLimitedBots).
  if (!name) notFound();
  return { title: name };
}

export default async function DriverPage({ params }: Props) {
  const slug = (await params).driver;
  const { seasons } = await loadSeasons();
  const p = profile(seasons, slug);
  if (p && p.seasons.length) {
    return (
      <PageContainer className="lg:py-10">
        <DriverProfile profile={p} />
      </PageContainer>
    );
  }
  const demo = findDriver(slug);
  if (!demo) notFound();
  const team = findTeam(demo.teamSlug);
  return (
    <ComingSoon
      eyebrow={`Driver · ${demo.code}${team ? ` · ${team.name}` : ""}`}
      title={demo.name}
      description="On the grid, but not yet in the race results we have."
      reason="This driver has no classified race in the results yet, so there are no results, form or comparisons to show. The profile appears after their first classified race."
      back={{ href: "/drivers", label: "All drivers" }}
    />
  );
}

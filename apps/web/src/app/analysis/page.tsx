import { CapabilityCard } from "@/components/data/capability-card";
import type { Tone } from "@/components/ui/badge";
import { PageContainer } from "@/components/ui/page-container";
import { PageHeader } from "@/components/ui/page-header";
import { ANALYSIS_HUB, PRODUCT_NAV } from "@/domain/navigation";
import { configured as engineerConfigured } from "@/lib/engineer/engineer";

export const metadata = { title: "Analysis" };

/** The analysis tools, each with its real availability (the engineer depends on the server having an AI key). */
export default function AnalysisPage() {
  const status: Record<string, { label: string; tone: Tone }> = {
    "/replay": { label: "2026 races", tone: "success" },
    "/telemetry": { label: "2026 laps", tone: "success" },
    "/strategy": { label: "2026 races", tone: "success" },
    "/race-engineer": engineerConfigured() ? { label: "AI · answers from race data", tone: "info" } : { label: "Offline on this server", tone: "neutral" },
  };
  return (
    <PageContainer>
      <PageHeader eyebrow="Analysis" title="Read the race" description={ANALYSIS_HUB.summary} />
      <ul className="border-b border-line [&>li:first-child>a]:border-t-0">
        {PRODUCT_NAV.map((t) => (
          <li key={t.href}>
            <CapabilityCard item={t} status={status[t.href]} />
          </li>
        ))}
      </ul>
    </PageContainer>
  );
}

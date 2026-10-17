import Link from "next/link";
import { Badge } from "@/components/ui/badge";
import { CardArrow } from "@/components/ui/card-arrow";
import { PageContainer } from "@/components/ui/page-container";
import { PageHeader } from "@/components/ui/page-header";
import { ANALYSIS_HUB, PRODUCT_NAV } from "@/domain/navigation";

export const metadata = { title: "Analysis" };

/** Index of the analysis tools. States each tool's real status: the Telemetry Lab, Race Replay, Strategy and the Race Engineer are available, the rest are planned. */
const STATUS: Record<string, { label: string; tone: "info" | "success" }> = {
  "/replay": { label: "Available · 2026 races", tone: "success" },
  "/telemetry": { label: "Available · 2026 laps", tone: "success" },
  "/strategy": { label: "Available · 2026 races", tone: "success" },
  "/race-engineer": { label: "Available · needs an API key", tone: "info" },
};

export default function AnalysisPage() {
  return (
    <PageContainer>
      <PageHeader eyebrow="Analysis" title="Analysis tools" description={ANALYSIS_HUB.summary} />
      <ul className="border-b border-line">
        {PRODUCT_NAV.map((t, i) => {
          const status = STATUS[t.href] ?? { label: `Planned · Phase ${t.phase}`, tone: "info" as const };
          return (
            <li key={t.href}>
              <Link
                href={t.href}
                className="group motion-interactive grid grid-cols-[2.5rem_1fr_auto] items-start gap-x-4 gap-y-1 border-t border-line px-1 py-5 hover:bg-surface/60 sm:grid-cols-[3rem_1fr_auto]"
              >
                <span className="font-display text-2xl leading-none text-subtle tabular-nums">{String(i + 1).padStart(2, "0")}</span>
                <span>
                  <span className="block text-lg font-medium leading-snug">{t.label}</span>
                  <span className="mt-1 block max-w-prose text-sm leading-relaxed text-muted">{t.summary}</span>
                </span>
                <span className="flex items-center gap-3 pt-1">
                  <Badge tone={status.tone}>{status.label}</Badge>
                  <CardArrow />
                </span>
              </Link>
            </li>
          );
        })}
      </ul>
    </PageContainer>
  );
}

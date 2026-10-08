import { ComingSoon } from "@/components/ui/coming-soon";
import { getNavItem } from "@/domain/navigation";

export const metadata = { title: "Strategy Intelligence" };

const PLANNED = [
    "Stint and compound timeline per driver",
    "Pace evolution and defensible degradation estimates",
    "What-if simulator, always labelled SIMULATION",
] as const;

export default function Page() {
  const { phase } = getNavItem("/strategy");
  return (
    <ComingSoon
      eyebrow="Analysis"
      title="Strategy Intelligence"
      description="Tyre stints, pit windows and what-if scenarios built on real race data."
      phase={phase}
      planned={PLANNED}
    />
  );
}

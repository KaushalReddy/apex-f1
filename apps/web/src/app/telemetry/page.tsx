import { ComingSoon } from "@/components/ui/coming-soon";
import { getNavItem } from "@/domain/navigation";

export const metadata = { title: "Telemetry Lab" };

const PLANNED = [
    "Speed, throttle, brake, RPM and gear traces",
    "Charts against time and track distance",
    "Select a point on a chart to jump the 3D replay to that spot",
] as const;

export default function Page() {
  const { phase } = getNavItem("/telemetry");
  return (
    <ComingSoon
      eyebrow="Analysis"
      title="Telemetry Lab"
      description="Compare two drivers lap by lap, linked to the 3D circuit."
      phase={phase}
      planned={PLANNED}
    />
  );
}

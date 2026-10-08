import { ComingSoon } from "@/components/ui/coming-soon";
import { getNavItem } from "@/domain/navigation";

export const metadata = { title: "Live Race" };

const PLANNED = [
    "3D circuit with real driver positions and smooth interpolation",
    "Leaderboard with gaps, tyres, lap and pit status",
    "Click a car to follow it and open its telemetry",
    "Clear LIVE / REPLAY mode distinction",
] as const;

export default function Page() {
  const { phase } = getNavItem("/live");
  return (
    <ComingSoon
      eyebrow="Live"
      title="Live Race"
      description="A large interactive 3D circuit where every car moves from real position data."
      phase={phase}
      planned={PLANNED}
    />
  );
}

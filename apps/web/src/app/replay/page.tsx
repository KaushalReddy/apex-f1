import { ComingSoon } from "@/components/ui/coming-soon";
import { getNavItem } from "@/domain/navigation";

export const metadata = { title: "Race Replay" };

const PLANNED = [
    "Play, pause, seek and 0.5x to 10x speeds",
    "Jump to a lap, driver, pit stop or safety car period",
    "Playback served from our own store, never from the provider",
] as const;

export default function Page() {
  const { phase } = getNavItem("/replay");
  return (
    <ComingSoon
      eyebrow="Analysis"
      title="Race Replay"
      description="Reconstruct a past session in 3D from stored telemetry."
      phase={phase}
      planned={PLANNED}
    />
  );
}

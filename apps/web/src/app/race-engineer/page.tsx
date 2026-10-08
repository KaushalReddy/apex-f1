import { ComingSoon } from "@/components/ui/coming-soon";
import { getNavItem } from "@/domain/navigation";

export const metadata = { title: "AI Race Engineer" };

const PLANNED = [
    "Natural-language questions grounded in structured race data",
    "Explains its sources and says so when data is missing",
    "Race Rewind: replay and explain why a position was lost",
] as const;

export default function Page() {
  const { phase } = getNavItem("/race-engineer");
  return (
    <ComingSoon
      eyebrow="Analysis"
      title="AI Race Engineer"
      description="Questions answered only from the platform's own race data."
      phase={phase}
      planned={PLANNED}
    />
  );
}

import Link from "next/link";
import { driversOf, type DemoTeam } from "@/domain/demo";

export function TeamCard({ team, base = "/teams" }: { team: DemoTeam; base?: "/teams" | "/cars" }) {
  const drivers = driversOf(team.slug);
  return (
    <Link
      href={`${base}/${team.slug}`}
      className="group relative block overflow-hidden rounded-lg border border-line bg-surface p-5 pl-6 shadow-1 transition-colors hover:border-line-strong hover:bg-surface-2"
    >
      <span aria-hidden="true" className="absolute inset-y-0 left-0 w-1" style={{ backgroundColor: team.color }} />
      <p className="text-base font-medium group-hover:text-accent-strong">{team.name}</p>
      <p className="mt-2 text-sm text-muted">{drivers.map((d) => d.name).join(" · ")}</p>
    </Link>
  );
}

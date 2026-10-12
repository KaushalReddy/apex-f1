import Link from "next/link";
import { Badge } from "@/components/ui/badge";
import type { DemoCircuit } from "@/domain/demo";

export function CircuitCard({ circuit, has3d = false }: { circuit: DemoCircuit; has3d?: boolean }) {
  return (
    <Link
      href={`/circuits/${circuit.slug}`}
      className="group block rounded-lg border border-line bg-surface p-5 shadow-1 transition-colors hover:border-line-strong hover:bg-surface-2"
    >
      <p className="eyebrow">{circuit.country}</p>
      <p className="mt-2 text-base font-medium group-hover:text-accent-strong">{circuit.name}</p>
      {has3d && <Badge tone="success" className="mt-3">3D</Badge>}
    </Link>
  );
}

import Link from "next/link";
import { Badge } from "@/components/ui/badge";
import { CARD_LINK, CardArrow } from "@/components/ui/card-arrow";
import type { DemoCircuit } from "@/domain/demo";

export function CircuitCard({ circuit, has3d = false }: { circuit: DemoCircuit; has3d?: boolean }) {
  return (
    <Link href={`/circuits/${circuit.slug}`} className={CARD_LINK}>
      <div className="flex items-start justify-between gap-2">
        <p className="eyebrow">{circuit.country}</p>
        <CardArrow />
      </div>
      <p className="mt-2 text-base font-medium">{circuit.name}</p>
      {has3d && <Badge tone="success" className="mt-3">3D</Badge>}
    </Link>
  );
}

import Link from "next/link";
import type { DemoCircuit } from "@/domain/demo";

export function CircuitCard({ circuit }: { circuit: DemoCircuit }) {
  return (
    <Link
      href={`/circuits/${circuit.slug}`}
      className="group block rounded-lg border border-line bg-surface p-5 shadow-1 transition-colors hover:border-line-strong hover:bg-surface-2"
    >
      <p className="eyebrow">{circuit.country}</p>
      <p className="mt-2 text-base font-medium group-hover:text-accent-strong">{circuit.name}</p>
    </Link>
  );
}

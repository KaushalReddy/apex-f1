import Link from "next/link";
import { Badge } from "@/components/ui/badge";
import { CardArrow } from "@/components/ui/card-arrow";
import type { NavItem } from "@/domain/navigation";

/** An indexed row (01, 02, ...) in the platform capability list; the whole row is the link. */
export function CapabilityCard({ item, title, index }: { item: NavItem; title: string; index: number }) {
  return (
    <Link
      href={item.href}
      className="group motion-interactive grid grid-cols-[2.5rem_1fr_auto] items-start gap-x-4 gap-y-1 border-t border-line px-1 py-5 hover:bg-surface/60 sm:grid-cols-[3rem_1fr_auto]"
    >
      <span className="font-display text-2xl leading-none text-subtle tabular-nums">{String(index).padStart(2, "0")}</span>
      <span>
        <span className="block text-lg font-medium leading-snug">{title}</span>
        <span className="mt-1 block max-w-prose text-sm leading-relaxed text-muted">{item.summary}</span>
      </span>
      <span className="flex items-center gap-3 pt-1">
        <Badge tone="info">Phase {item.phase}</Badge>
        <CardArrow />
      </span>
    </Link>
  );
}

import Link from "next/link";
import { Badge } from "@/components/ui/badge";
import type { NavItem } from "@/domain/navigation";

export function CapabilityCard({ item, title }: { item: NavItem; title: string }) {
  return (
    <Link
      href={item.href}
      className="group flex h-full flex-col rounded-lg border border-line bg-surface p-5 shadow-1 transition-colors hover:border-line-strong hover:bg-surface-2"
    >
      <div className="flex items-start justify-between gap-3">
        <h3 className="text-base font-semibold group-hover:text-accent-strong">{title}</h3>
        <Badge tone="info">Phase {item.phase}</Badge>
      </div>
      <p className="mt-3 text-sm leading-relaxed text-muted">{item.summary}</p>
    </Link>
  );
}

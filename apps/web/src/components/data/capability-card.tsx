import Link from "next/link";
import { Badge, type Tone } from "@/components/ui/badge";
import { CardArrow } from "@/components/ui/card-arrow";
import type { NavItem } from "@/domain/navigation";

/** A row in a list of tools; the whole row is the link. `status` is a real availability label, when there is one worth stating. */
export function CapabilityCard({ item, title, status }: { item: NavItem; title?: string; status?: { label: string; tone: Tone } }) {
  return (
    <Link href={item.href} className="group motion-interactive grid grid-cols-[1fr_auto] items-start gap-x-4 gap-y-1 border-t border-line px-1 py-5 hover:bg-surface/60">
      <span>
        <span className="block text-lg font-medium leading-snug">{title ?? item.label}</span>
        <span className="mt-1 block max-w-prose text-sm leading-relaxed text-muted">{item.summary}</span>
      </span>
      <span className="flex items-center gap-3 pt-1">
        {status && <Badge tone={status.tone}>{status.label}</Badge>}
        <CardArrow />
      </span>
    </Link>
  );
}

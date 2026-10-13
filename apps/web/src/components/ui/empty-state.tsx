import type { ReactNode } from "react";
import { Badge, type Tone } from "./badge";
import { cn } from "@/lib/cn";

/**
 * A deliberate "there is nothing to show, and here is why" state. Use it instead of placeholder rows or skeletons whenever data is
 * unavailable, unconnected or not built yet; skeletons are for content that is genuinely loading.
 */
export function EmptyState({
  title,
  children,
  status,
  statusTone = "neutral",
  action,
  className,
  headingLevel: H = "h3",
}: {
  title: string;
  children: ReactNode;
  status?: string;
  statusTone?: Tone;
  action?: ReactNode;
  className?: string;
  headingLevel?: "h2" | "h3" | "h4";
}) {
  return (
    <div className={cn("rounded-lg border border-dashed border-line-strong bg-surface/40 p-6", className)}>
      {status && <Badge tone={statusTone}>{status}</Badge>}
      <H className="mt-3 text-base font-semibold text-fg">{title}</H>
      <div className="mt-2 max-w-prose text-sm leading-relaxed text-muted">{children}</div>
      {action && <div className="mt-4">{action}</div>}
    </div>
  );
}

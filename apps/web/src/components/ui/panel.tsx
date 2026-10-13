import type { ReactNode } from "react";
import { cn } from "@/lib/cn";

type PanelProps = {
  as?: "div" | "section" | "article";
  className?: string;
  children: ReactNode;
  "aria-labelledby"?: string;
};

/** Static container. It has no hover or pointer styling on purpose: interactive surfaces are CardLink-style components. */
export function Panel({ as: Tag = "div", className, children, ...rest }: PanelProps) {
  return (
    <Tag className={cn("rounded-lg border border-line bg-surface p-5 sm:p-6", className)} {...rest}>
      {children}
    </Tag>
  );
}

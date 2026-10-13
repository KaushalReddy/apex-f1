"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { cn } from "@/lib/cn";
import { isActivePath } from "@/domain/navigation";

const styles = {
  primary: "h-14 px-3 text-sm",
  secondary: "h-10 px-2.5 text-[0.8125rem]",
  mobile: "min-h-11 px-3 text-[0.9375rem]",
} as const;

/**
 * One navigation link for header, secondary row and mobile menu. A real next/link (so it is an <a>, shows the pointer cursor, works with
 * keyboard, middle-click and refresh). The active route gets an animated red indicator and aria-current, not colour alone.
 */
export function NavLink({ href, label, variant }: { href: string; label: string; variant: keyof typeof styles }) {
  const pathname = usePathname();
  const active = isActivePath(pathname, href);
  const bar = variant === "mobile" ? "before:inset-y-2 before:left-0 before:w-0.5 before:origin-top before:scale-y-0" : "before:inset-x-3 before:bottom-0 before:h-0.5 before:origin-left before:scale-x-0";
  return (
    <Link
      href={href}
      aria-current={active ? "page" : undefined}
      className={cn(
        "motion-interactive relative inline-flex items-center rounded-md font-medium",
        "before:pointer-events-none before:absolute before:bg-accent before:transition-transform before:duration-[var(--duration-base)] before:ease-[var(--ease-apex)] before:content-['']",
        bar,
        styles[variant],
        variant === "mobile" && "flex w-full",
        active ? "text-fg before:scale-100" : "text-muted hover:text-fg",
        active && variant === "mobile" && "bg-surface-2",
        !active && variant === "mobile" && "hover:bg-surface-2",
      )}
    >
      {label}
    </Link>
  );
}

"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { cn } from "@/lib/cn";
import { isActivePath } from "@/domain/navigation";

const styles = {
  primary: "px-3 py-2 text-[0.8125rem] font-medium uppercase tracking-[0.12em]",
  secondary: "px-2.5 py-1.5 text-xs uppercase tracking-[0.12em]",
  mobile: "block px-3 py-3 text-sm font-medium uppercase tracking-[0.12em]",
} as const;

export function NavLink({ href, label, variant }: { href: string; label: string; variant: keyof typeof styles }) {
  const pathname = usePathname();
  const active = isActivePath(pathname, href);
  return (
    <Link
      href={href}
      aria-current={active ? "page" : undefined}
      className={cn(
        "relative rounded-md transition-colors",
        styles[variant],
        active ? "text-fg" : "text-muted hover:text-fg",
        active && variant !== "mobile" && "after:absolute after:inset-x-3 after:-bottom-px after:h-0.5 after:bg-accent",
        active && variant === "mobile" && "bg-surface-2 text-fg",
      )}
    >
      {label}
    </Link>
  );
}

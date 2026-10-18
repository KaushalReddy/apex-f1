"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import type { ReactNode } from "react";
import { cn } from "@/lib/cn";
import { PRIMARY_NAV, PRODUCT_NAV, isActivePath } from "@/domain/navigation";
import { BrandMark } from "./brand";

/**
 * Top bar for the full-window views (Live race, Car Lab), which cover the site header: the main sections stay one click away, the
 * current one is marked, and the view's own actions (browser fullscreen, Exit) sit on the right. Thin and translucent so the 3D scene
 * stays the focus. `onBack` adds a back arrow at the far left (the view's leave: previous page on this site, else its section).
 */
export function ImmersiveNav({ actions, onBack }: { actions?: ReactNode; onBack?: () => void }) {
  const pathname = usePathname();
  const link = (href: string, label: string) => {
    const active = isActivePath(pathname, href);
    return (
      <Link
        key={href}
        href={href}
        aria-current={active ? "page" : undefined}
        className={cn(
          "motion-interactive inline-flex h-8 shrink-0 items-center rounded-md px-2.5 text-sm font-medium",
          active
            ? "bg-white/10 text-fg"
            : "text-muted hover:bg-white/5 hover:text-fg",
        )}
      >
        {label}
      </Link>
    );
  };
  return (
    <nav
      aria-label="Site"
      className="absolute inset-x-0 top-0 z-30 flex h-12 items-center gap-2 border-b border-white/10 bg-bg/75 px-2 backdrop-blur-xl supports-[not(backdrop-filter:blur(1px))]:bg-bg sm:px-4"
    >
      {onBack && (
        <button
          type="button"
          onClick={onBack}
          aria-label="Back"
          title="Back"
          className="motion-interactive inline-flex size-8 shrink-0 items-center justify-center rounded-md text-muted hover:bg-white/5 hover:text-fg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
        >
          <svg aria-hidden="true" viewBox="0 0 20 20" className="size-4" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
            <path d="M16 10H4m5-5-5 5 5 5" />
          </svg>
        </button>
      )}
      <Link
        href="/"
        aria-label="APEX F1, home"
        className="motion-interactive flex shrink-0 items-center gap-2 text-fg"
      >
        <BrandMark className="size-6" />
        <span className="hidden font-display text-lg font-semibold leading-none tracking-[0.08em] md:inline">
          APEX<span className="text-accent-strong"> F1</span>
        </span>
      </Link>
      <div className="flex min-w-0 flex-1 items-center gap-0.5 overflow-x-auto [scrollbar-width:none]">
        {PRIMARY_NAV.map((i) => link(i.href, i.label))}
      </div>
      {/* Outside the scrolling row so the menu is not clipped. */}
      <details className="relative hidden shrink-0 lg:block">
        <summary className="motion-interactive inline-flex h-8 cursor-pointer list-none items-center rounded-md px-2.5 text-sm font-medium text-muted hover:bg-white/5 hover:text-fg">
          More
        </summary>
        <div className="absolute left-0 top-9 flex min-w-[11rem] flex-col gap-0.5 rounded-lg border border-white/10 bg-surface/95 p-1 shadow-2 backdrop-blur-xl">
          {PRODUCT_NAV.map((i) => link(i.href, i.label))}
        </div>
      </details>
      {actions && (
        <div className="flex shrink-0 items-center gap-1">{actions}</div>
      )}
    </nav>
  );
}

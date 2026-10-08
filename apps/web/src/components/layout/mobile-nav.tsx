"use client";

import { useEffect, useRef, useState } from "react";
import { usePathname } from "next/navigation";
import { PRIMARY_NAV, PRODUCT_NAV } from "@/domain/navigation";
import { NavLink } from "./nav-link";

export function MobileNav() {
  const pathname = usePathname();
  // The menu is open only for the page it was opened on, so navigating closes it without an effect.
  const [openAt, setOpenAt] = useState<string | null>(null);
  const open = openAt === pathname;
  const buttonRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        setOpenAt(null);
        buttonRef.current?.focus();
      }
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [open]);

  return (
    <div className="lg:hidden">
      <button
        ref={buttonRef}
        type="button"
        aria-expanded={open}
        aria-controls="mobile-nav"
        onClick={() => setOpenAt(open ? null : pathname)}
        className="inline-flex h-9 items-center gap-2 rounded-md border border-line-strong px-3 text-xs font-medium uppercase tracking-[0.12em] text-fg"
      >
        <svg viewBox="0 0 16 16" className="size-4" fill="none" stroke="currentColor" strokeWidth="1.6" aria-hidden="true">
          {open ? <path d="M3 3l10 10M13 3 3 13" /> : <path d="M2 4h12M2 8h12M2 12h12" />}
        </svg>
        Menu
      </button>
      <div
        id="mobile-nav"
        hidden={!open}
        className="absolute inset-x-0 top-full max-h-[calc(100dvh-3.5rem)] overflow-y-auto border-b border-line bg-bg px-4 pb-6 pt-2 shadow-2 sm:px-6"
      >
        <nav aria-label="Primary mobile">
          <ul className="grid grid-cols-2 gap-1">
            {PRIMARY_NAV.map((i) => (
              <li key={i.href}>
                <NavLink href={i.href} label={i.label} variant="mobile" />
              </li>
            ))}
          </ul>
        </nav>
        <nav aria-label="Product areas mobile" className="mt-4 border-t border-line pt-4">
          <p className="eyebrow px-3 pb-2">Analysis</p>
          <ul className="grid grid-cols-2 gap-1">
            {PRODUCT_NAV.map((i) => (
              <li key={i.href}>
                <NavLink href={i.href} label={i.label} variant="mobile" />
              </li>
            ))}
          </ul>
        </nav>
      </div>
    </div>
  );
}

"use client";

import { useEffect, useId, useState, type ReactNode } from "react";

/** Small "i" button with a tooltip: opens on hover or focus, closes on Escape (WCAG 1.4.13). */
export function InfoTip({ label, children }: { label: string; children: ReactNode }) {
  const id = useId();
  const [open, setOpen] = useState(false);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [open]);

  return (
    <span className="relative inline-flex" onMouseEnter={() => setOpen(true)} onMouseLeave={() => setOpen(false)}>
      <button
        type="button"
        aria-label={label}
        aria-describedby={open ? id : undefined}
        onFocus={() => setOpen(true)}
        onBlur={() => setOpen(false)}
        className="inline-flex size-5 items-center justify-center rounded-full border border-line-strong font-mono text-[0.6875rem] text-muted hover:text-fg"
      >
        i
      </button>
      {open && (
        <span
          role="tooltip"
          id={id}
          className="absolute left-1/2 top-full z-50 mt-2 w-64 -translate-x-1/2 rounded-md border border-line-strong bg-surface-3 p-3 text-xs leading-relaxed text-fg shadow-2"
        >
          {children}
        </span>
      )}
    </span>
  );
}

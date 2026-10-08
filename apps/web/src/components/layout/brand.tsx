import Link from "next/link";

export function BrandMark({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 28 28" fill="none" aria-hidden="true" className={className}>
      <path d="M4 23 14 5l10 18" stroke="currentColor" strokeWidth="2.4" strokeLinecap="square" strokeLinejoin="miter" />
      <path d="M8.5 17c3-3.2 8-3.2 11 0" stroke="var(--color-accent)" strokeWidth="2.4" strokeLinecap="round" />
    </svg>
  );
}

export function Brand() {
  return (
    <Link href="/" className="flex items-center gap-2.5 text-fg" aria-label="APEX F1, home">
      <BrandMark className="size-7" />
      <span className="text-[1.0625rem] font-semibold tracking-[0.18em]">
        APEX<span className="text-accent"> F1</span>
      </span>
    </Link>
  );
}

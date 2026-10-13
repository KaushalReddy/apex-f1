import type { ReactNode } from "react";
import { SectionMarker } from "./section-header";

export function PageHeader({
  eyebrow,
  title,
  description,
  badges,
  actions,
}: {
  eyebrow?: string;
  title: string;
  description?: string;
  badges?: ReactNode;
  actions?: ReactNode;
}) {
  return (
    <header className="mb-10 flex flex-col gap-6 border-b border-line pb-8 sm:flex-row sm:items-end sm:justify-between">
      <div className="max-w-3xl">
        {eyebrow && (
          <p className="eyebrow flex items-center">
            <SectionMarker />
            {eyebrow}
          </p>
        )}
        <h1 className="mt-3 text-balance font-display text-4xl font-semibold leading-[1.05] tracking-[0.01em] sm:text-5xl">{title}</h1>
        {description && <p className="mt-4 max-w-2xl text-pretty text-base leading-relaxed text-muted">{description}</p>}
        {badges && <div className="mt-5 flex flex-wrap items-center gap-2">{badges}</div>}
      </div>
      {actions && <div className="flex shrink-0 flex-wrap gap-3">{actions}</div>}
    </header>
  );
}

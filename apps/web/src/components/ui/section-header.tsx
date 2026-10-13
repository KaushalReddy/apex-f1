import type { ReactNode } from "react";

/** The one recurring graphic device: a short red tick before a micro-label. Decorative, hidden from assistive tech. */
export function SectionMarker() {
  return <span aria-hidden="true" className="mr-2.5 inline-block h-3 w-0.5 bg-accent" />;
}

export function SectionHeader({
  id,
  eyebrow,
  title,
  description,
  action,
}: {
  id: string;
  eyebrow?: string;
  title: string;
  description?: string;
  action?: ReactNode;
}) {
  return (
    <div className="mb-6 flex flex-wrap items-end justify-between gap-4">
      <div className="max-w-2xl">
        {eyebrow && (
          <p className="eyebrow flex items-center">
            <SectionMarker />
            {eyebrow}
          </p>
        )}
        <h2 id={id} className="mt-2 font-display text-3xl font-semibold leading-tight tracking-[0.01em]">
          {title}
        </h2>
        {description && <p className="mt-2 text-sm leading-relaxed text-muted">{description}</p>}
      </div>
      {action}
    </div>
  );
}

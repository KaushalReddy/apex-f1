import type { ReactNode } from "react";

/** Label/value rows. Values align right on wide screens and wrap under their label on narrow ones; numerals are tabular. */
export function KeyValueList({ items }: { items: ReadonlyArray<{ label: string; value: ReactNode }> }) {
  return (
    <dl className="divide-y divide-line text-sm">
      {items.map((i) => (
        <div key={i.label} className="flex flex-col gap-1 py-3 first:pt-0 last:pb-0 sm:flex-row sm:items-center sm:justify-between sm:gap-4">
          <dt className="shrink-0 text-muted">{i.label}</dt>
          <dd className="flex min-w-0 items-center gap-2 break-words font-medium tabular-nums sm:text-right">{i.value}</dd>
        </div>
      ))}
    </dl>
  );
}

import type { ReactNode } from "react";

export function KeyValueList({ items }: { items: ReadonlyArray<{ label: string; value: ReactNode }> }) {
  return (
    <dl className="divide-y divide-line text-sm">
      {items.map((i) => (
        <div key={i.label} className="flex items-center justify-between gap-4 py-3 first:pt-0 last:pb-0">
          <dt className="text-muted">{i.label}</dt>
          <dd className="flex items-center gap-2 text-right font-medium">{i.value}</dd>
        </div>
      ))}
    </dl>
  );
}

/** Skeleton rows for a table that has no data source yet. Purely visual; labelled for assistive tech. */
export function StandingsPlaceholder({ label, rows = 5 }: { label: string; rows?: number }) {
  return (
    <div role="img" aria-label={`${label}: no data connected yet`}>
      <ol aria-hidden="true" className="divide-y divide-line">
        {Array.from({ length: rows }, (_, i) => (
          <li key={i} className="flex items-center gap-4 py-3">
            <span className="w-5 font-mono text-sm text-subtle">{i + 1}</span>
            <span className="h-2.5 flex-1 rounded-sm bg-surface-3" style={{ maxWidth: `${70 - i * 8}%` }} />
            <span className="h-2.5 w-10 rounded-sm bg-surface-3" />
          </li>
        ))}
      </ol>
    </div>
  );
}

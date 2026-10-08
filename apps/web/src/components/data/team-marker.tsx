export function TeamMarker({ color }: { color: string }) {
  return <span aria-hidden="true" className="inline-block h-4 w-1 shrink-0 rounded-sm" style={{ backgroundColor: color }} />;
}

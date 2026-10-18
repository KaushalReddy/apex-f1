/** "just now", "4 min ago", "3 h ago", "2 days ago": how long ago APEX F1 retrieved something (never the source's own time). */
export function ago(iso: string | null, now: number): string | null {
  if (!iso) return null;
  const s = Math.max(0, Math.round((now - Date.parse(iso)) / 1000));
  if (!Number.isFinite(s)) return null;
  if (s < 45) return "just now";
  if (s < 3600) return `${Math.round(s / 60)} min ago`;
  if (s < 2 * 86_400) return `${Math.round(s / 3600)} h ago`;
  return `${Math.round(s / 86_400)} days ago`;
}

/** Wall-clock time of a source timestamp in the viewer's time zone, to the second (e.g. "14:03:22 BST"). */
export const clockTime = (iso: string) => new Date(iso).toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit", second: "2-digit", timeZoneName: "short" });

/** A scheduled start in the viewer's time zone (e.g. "Fri 30 Oct, 19:30 GMT"). */
export const sessionStart = (iso: string) =>
  new Date(iso).toLocaleString(undefined, { weekday: "short", day: "numeric", month: "short", hour: "2-digit", minute: "2-digit", timeZoneName: "short" });

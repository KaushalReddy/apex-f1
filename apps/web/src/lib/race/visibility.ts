/**
 * Circuit focus ("hollowing out" drivers on the 3D circuit). A purely visual state: it never changes positions, order, timing or data.
 *
 * Single source of truth: the user's focus set (null = no filter, everyone shown normally), edited only by the Drivers control. Comparison
 * mode never writes to it; while comparing, the compared pair is emphasised instead, so exiting comparison restores the user's selection
 * untouched. Ids not in the current session are ignored (a stale selection never hides everyone).
 */
export type FocusSet = ReadonlySet<string> | null;

export interface Emphasis {
  /** Drivers drawn normally; null = all of them. Everyone else is hollowed out. */
  prominent: ReadonlySet<string> | null;
  source: "all" | "focus" | "compare";
}

/** The focus set restricted to drivers present in the session; null when nothing valid remains. */
export function reconcile(focus: FocusSet, present: ReadonlySet<string>): FocusSet {
  if (!focus) return null;
  const kept = [...focus].filter((id) => present.has(id));
  return kept.length ? new Set(kept) : null;
}

/** What the circuit shows: the compared pair while comparing (both present), else the user's reconciled focus, else everyone. */
export function emphasis(focus: FocusSet, compare: readonly [string, string] | null, present: ReadonlySet<string>): Emphasis {
  if (compare && present.has(compare[0]) && present.has(compare[1])) return { prominent: new Set(compare), source: "compare" };
  const f = reconcile(focus, present);
  return f ? { prominent: f, source: "focus" } : { prominent: null, source: "all" };
}

export const isHollow = (e: Emphasis, id: string) => e.prominent != null && !e.prominent.has(id);

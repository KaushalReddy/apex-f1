/** A label's screen rectangle (CSS pixels) and how much it matters. */
export interface LabelBox {
  id: string;
  x: number;
  y: number;
  w: number;
  h: number;
  priority: number;
}

/**
 * Greedy label placement: the most important labels are kept, and any label that would overlap one already kept is hidden. Labels whose
 * anchor is off screen are dropped. O(n^2), fine for a grid of cars.
 */
export function declutter(boxes: readonly LabelBox[], viewport: { w: number; h: number }, pad = 3): Set<string> {
  const kept: LabelBox[] = [];
  const sorted = [...boxes].sort((a, b) => b.priority - a.priority || a.id.localeCompare(b.id));
  for (const b of sorted) {
    if (b.x + b.w < 0 || b.y + b.h < 0 || b.x > viewport.w || b.y > viewport.h) continue;
    const overlaps = kept.some((k) => b.x < k.x + k.w + pad && b.x + b.w + pad > k.x && b.y < k.y + k.h + pad && b.y + b.h + pad > k.y);
    if (!overlaps) kept.push(b);
  }
  return new Set(kept.map((k) => k.id));
}

/** Label priority: the selected driver, then focused (battle) drivers, then the leader, then race order. */
export function labelPriority(o: { selected: boolean; focused: boolean; position: number | null }): number {
  return (o.selected ? 1000 : 0) + (o.focused ? 500 : 0) + (o.position === 1 ? 200 : 0) + (o.position != null ? 100 - o.position : 0);
}

/** A label to place next to its marker: marker centre (mx, my) and the label's full and compact (code-only) sizes, CSS pixels. */
export interface LabelAnchor {
  id: string;
  mx: number;
  my: number;
  w: number;
  wCompact: number;
  h: number;
  priority: number;
}

export interface LabelPlacement {
  x: number;
  y: number;
  compact: boolean;
  /** Which spot around the marker was used (index into the candidate list); fed back next frame to keep labels steady. */
  slot: number;
}

type Box = { x: number; y: number; w: number; h: number };
const overlaps = (a: Box, b: Box, pad: number) => a.x < b.x + b.w + pad && a.x + a.w + pad > b.x && a.y < b.y + b.h + pad && a.y + a.h + pad > b.y;

/**
 * Spots touching the marker only (no leader lines): right, left, above, below, then the four corners. A label is always visibly attached
 * to its own marker or not shown.
 */
function candidates(mx: number, my: number, w: number, h: number, r: number): Array<{ x: number; y: number }> {
  const g = 3;
  return [
    { x: mx + r + g, y: my - h / 2 },
    { x: mx - r - g - w, y: my - h / 2 },
    { x: mx - w / 2, y: my - r - g - h },
    { x: mx - w / 2, y: my + r + g },
    { x: mx + r * 0.7, y: my - r * 0.7 - h },
    { x: mx + r * 0.7, y: my + r * 0.7 },
    { x: mx - r * 0.7 - w, y: my - r * 0.7 - h },
    { x: mx - r * 0.7 - w, y: my + r * 0.7 },
  ];
}

/**
 * Deterministic label placement. In priority order (selected, focused battle, leader, race order), each label takes a free spot touching
 * its marker: the spot it used last frame if that is still free (so labels do not hop from side to side through corners), otherwise the
 * first free one in a fixed order. If none is free it retries as a compact (code-only) label, then it is hidden. The selected driver's
 * label is never hidden. Spots must stay inside the canvas and clear every marker and every label already placed.
 */
export function placeLabels(
  anchors: readonly LabelAnchor[],
  viewport: { w: number; h: number },
  opts: { markerR?: number; pad?: number; edge?: number; mustShow?: string | null; previous?: ReadonlyMap<string, LabelPlacement> } = {},
): Map<string, LabelPlacement> {
  const r = opts.markerR ?? 7;
  const pad = opts.pad ?? 2;
  const edge = opts.edge ?? 4;
  const placed = new Map<string, LabelPlacement>();
  const obstacles: Box[] = anchors.map((a) => ({ x: a.mx - r, y: a.my - r, w: 2 * r, h: 2 * r }));
  const inView = (b: Box) => b.x >= edge && b.y >= edge && b.x + b.w <= viewport.w - edge && b.y + b.h <= viewport.h - edge;
  const sorted = [...anchors].sort((a, b) => b.priority - a.priority || a.id.localeCompare(b.id));
  for (const a of sorted) {
    const prev = opts.previous?.get(a.id);
    let done = false;
    for (const compact of prev?.compact ? [true, false] : [false, true]) {
      const w = compact ? a.wCompact : a.w;
      const spots = candidates(a.mx, a.my, w, a.h, r).map((c, slot) => ({ ...c, slot }));
      if (prev) spots.unshift(spots[prev.slot]); // try last frame's spot first
      for (const c of spots) {
        const box = { x: c.x, y: c.y, w, h: a.h };
        if (!inView(box) || obstacles.some((o) => overlaps(box, o, pad))) continue;
        placed.set(a.id, { x: c.x, y: c.y, compact, slot: c.slot });
        obstacles.push(box);
        done = true;
        break;
      }
      if (done) break;
    }
    if (!done && a.id === opts.mustShow) {
      const c = candidates(a.mx, a.my, a.w, a.h, r)[0];
      const x = Math.max(edge, Math.min(viewport.w - a.w - edge, c.x));
      const y = Math.max(edge, Math.min(viewport.h - a.h - edge, c.y));
      placed.set(a.id, { x, y, compact: false, slot: 0 });
      obstacles.push({ x, y, w: a.w, h: a.h });
    }
  }
  return placed;
}

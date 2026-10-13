import type { ResultRow, ResultStatus, SeasonResults } from "./types";

const STATUSES: readonly ResultStatus[] = ["FIN", "DNF", "DNS", "DSQ", "NC"];
const isPos = (v: unknown) => v === null || (Number.isInteger(v) && (v as number) >= 1 && (v as number) <= 40);
const isNum = (v: unknown) => v === null || v === undefined || (typeof v === "number" && Number.isFinite(v));

function rowProblem(r: ResultRow, where: string): string | null {
  if (!r || typeof r.acronym !== "string" || !r.acronym) return `${where}: missing acronym`;
  if (!STATUSES.includes(r.status)) return `${where}: unknown status ${String(r.status)}`;
  if (!isPos(r.position)) return `${where}: bad position`;
  if (r.status === "FIN" && r.position === null) return `${where}: classified without a position`;
  if (!isNum(r.points) || !isNum(r.laps)) return `${where}: bad number`;
  return null;
}

/** Validates a season snapshot. Returns the first problem found, or the typed document. */
export function parseSeasonResults(raw: unknown): { ok: true; season: SeasonResults } | { ok: false; error: string } {
  const d = raw as SeasonResults;
  if (!d || d.schema !== "apex-f1/season-results@1") return { ok: false, error: "unknown schema" };
  if (!Number.isInteger(d.season) || !Array.isArray(d.events) || !Array.isArray(d.drivers)) return { ok: false, error: "missing season, events or drivers" };
  if (!d.source?.name || !d.source?.fetchedOn) return { ok: false, error: "missing provenance" };
  let prevRound = 0;
  for (const e of d.events) {
    if (!Number.isInteger(e.round) || e.round <= prevRound) return { ok: false, error: `events out of order at round ${e.round}` };
    prevRound = e.round;
    for (const [label, s] of [["race", e.race], ["sprint", e.sprint], ["qualifying", e.qualifying]] as const) {
      if (s == null) {
        if (label === "race") return { ok: false, error: `round ${e.round}: no race classification` };
        continue;
      }
      for (const r of s.results) {
        const p = rowProblem(r, `round ${e.round} ${label}`);
        if (p) return { ok: false, error: p };
      }
    }
  }
  return { ok: true, season: d };
}

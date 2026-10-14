import { driverRegistry } from "@/lib/drivers/identity";
import type { SeasonResults } from "@/lib/drivers/types";
import { circuitByShortName, type CircuitEntry } from "./catalog";

/**
 * Grands Prix at a circuit in the exported seasons (OpenF1 classifications): race winner and fastest qualifier per event. Only what
 * the snapshots contain; seasons outside them are not listed.
 */
export interface CircuitEvent {
  season: number;
  round: number;
  name: string;
  date: string;
  winner: { acronym: string; name: string; slug: string | null; team: string | null } | null;
  qualifyingP1: { acronym: string; name: string; slug: string | null } | null;
}

export function circuitHistory(circuit: CircuitEntry, seasons: readonly SeasonResults[]): CircuitEvent[] {
  const reg = new Map(driverRegistry(seasons).map((r) => [r.acronym, r]));
  const who = (acronym: string) => ({ acronym, name: reg.get(acronym)?.name ?? acronym, slug: reg.get(acronym)?.slug ?? null });
  const out: CircuitEvent[] = [];
  for (const s of seasons)
    for (const e of s.events) {
      if (circuitByShortName(e.circuitShortName)?.id !== circuit.id) continue;
      const w = e.race.results.find((r) => r.position === 1 && r.status === "FIN");
      const q = e.qualifying?.results.find((r) => r.position === 1);
      out.push({ season: s.season, round: e.round, name: e.name, date: e.date, winner: w ? { ...who(w.acronym), team: w.team } : null, qualifyingP1: q ? who(q.acronym) : null });
    }
  return out.sort((a, b) => b.date.localeCompare(a.date));
}

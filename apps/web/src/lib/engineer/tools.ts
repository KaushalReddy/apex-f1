import type { ReplayDataset } from "@/lib/replay/dataset";
import { comparable, consistency, lapRows, neutralisedPeriods } from "@/lib/replay/laps";
import { ReplayModel } from "@/lib/replay/model";
import { classify, messageText } from "@/lib/replay/raceControl";
import { rewindSteps, rewindSummary } from "@/lib/replay/rewind";
import { finalGaps, stintsOf } from "@/lib/strategy/strategy";

/**
 * The Race Engineer's tools (Phase 14): the only way the model sees race data. Every result comes from the exported OpenF1 dataset through
 * the same code as the Replay and Strategy pages; nothing here is generated. Times are given as replay ms (`t`, for links) and race clock.
 */

/**
 * The dataset as it stood at replay time `until`: laps completed, gaps, order, pits, messages and weather up to then, stints cut at the
 * last completed lap. Every tool reads only this, so the replay panel cannot reveal what happens later (no spoilers by construction).
 */
export function cutAt(ds: ReplayDataset, until: number | null): ReplayDataset {
  if (until == null || until >= ds.durationMs) return ds;
  const drivers = ds.drivers.map((d) => {
    const laps = d.laps.filter(([, start, s]) => s != null && start + s * 1000 <= until);
    const last = laps.at(-1)?.[0] ?? 0;
    const keep = d.intervals.t.map((t, i) => (t <= until ? i : -1)).filter((i) => i >= 0);
    return {
      ...d,
      positions: { t: [], x: [], y: [] },
      laps,
      intervals: { t: keep.map((i) => d.intervals.t[i]), gap: keep.map((i) => d.intervals.gap[i]), interval: keep.map((i) => d.intervals.interval[i]), lapsDown: keep.map((i) => d.intervals.lapsDown[i]) },
      stints: d.stints.filter((s) => s.lapStart != null && s.lapStart <= Math.max(1, last)).map((s) => ({ ...s, lapEnd: s.lapEnd != null && s.lapEnd <= last ? s.lapEnd : null })),
    };
  });
  const w = ds.weather;
  const wi = w ? w.t.map((t, i) => (t <= until ? i : -1)).filter((i) => i >= 0) : [];
  const pick = <T,>(xs: T[]) => wi.map((i) => xs[i]);
  return {
    ...ds,
    durationMs: until,
    drivers,
    order: ds.order.filter(([t]) => t <= until),
    pits: ds.pits.filter((p) => p.t <= until),
    raceControl: ds.raceControl.filter((m) => m.t <= until),
    overtakes: ds.overtakes.filter(([t]) => t <= until),
    weather: w ? { t: pick(w.t), air: pick(w.air), track: pick(w.track), humidity: pick(w.humidity), pressure: pick(w.pressure), rain: pick(w.rain), windSpeed: pick(w.windSpeed), windDir: pick(w.windDir) } : null,
  };
}

const r3 = (v: number | null | undefined) => (v == null ? null : Math.round(v * 1000) / 1000);
const r1 = (v: number | null | undefined) => (v == null ? null : Math.round(v * 10) / 10);

export class EngineerData {
  readonly m: ReplayModel;
  readonly partial: boolean;
  constructor(full: ReplayDataset, until: number | null) {
    this.m = new ReplayModel(cutAt(full, until), null);
    this.partial = this.m.ds.durationMs < full.durationMs;
  }

  /** Race clock from lights out, h:mm:ss. */
  clock(t: number) {
    const s = Math.round((t - this.m.ds.lightsOutMs) / 1000);
    const a = Math.abs(s);
    return `${s < 0 ? "-" : ""}${Math.floor(a / 3600)}:${String(Math.floor((a % 3600) / 60)).padStart(2, "0")}:${String(a % 60).padStart(2, "0")}`;
  }

  /** A driver by three-letter code, car number or (part of) surname; null if none or ambiguous. */
  driver(q: string): number | null {
    const s = q.trim().toUpperCase();
    const ds = this.m.ds.drivers;
    const exact = ds.findIndex((d) => d.acronym?.toUpperCase() === s || String(d.number) === s.replace(/^#/, ""));
    if (exact >= 0) return exact;
    const byName = ds.map((d, i) => (d.fullName?.toUpperCase().includes(s) ? i : -1)).filter((i) => i >= 0);
    return byName.length === 1 ? byName[0] : null;
  }

  code(i: number) {
    const d = this.m.ds.drivers[i];
    return d.acronym ?? `#${d.number}`;
  }

  /** Leader's laps completed (the race distance so far). */
  lapsDone() {
    return Math.max(0, ...this.m.ds.drivers.map((d) => d.laps.at(-1)?.[0] ?? 0));
  }

  /** Lap a time falls in, by the leader's lap starts at that time (for periods and messages without a lap). */
  lapOf(t: number) {
    const leader = this.m.ds.drivers.findIndex((d) => this.m.positionOf(d.number, t) === 1);
    return leader >= 0 ? this.m.lapAt(leader, t).lap : null;
  }

  summary() {
    const m = this.m;
    const finals = finalGaps(m);
    const fastest = m.ds.drivers
      .flatMap((d, i) => lapRows(m, i).filter(comparable).map((r) => ({ i, lap: r.lap, s: r.lapS as number })))
      .sort((a, b) => a.s - b.s)[0];
    const w = m.ds.weather;
    const vals = (xs: (number | null)[] | undefined) => (xs ?? []).filter((v): v is number => v != null && v !== 0);
    const air = vals(w?.air);
    const track = vals(w?.track);
    return {
      race: `${m.ds.eventName} ${m.ds.season}`,
      date: m.ds.date,
      scope: this.partial ? `Data up to race clock ${this.clock(m.ds.durationMs)} (lap ${this.lapsDone()} completed by the leader). Nothing later is known.` : "Whole race.",
      laps_completed_by_leader: this.lapsDone(),
      [this.partial ? "current_order" : "final_classification"]: finals.map((f) => {
        const i = m.ds.drivers.findIndex((d) => d.number === f.number);
        const d = m.ds.drivers[i];
        return {
          position: f.position,
          driver: this.code(i),
          name: d.fullName,
          team: d.team,
          gap_to_leader_s: f.lapsDown ? null : r3(f.gap),
          laps_down: f.lapsDown || null,
          start_position: m.positionOf(d.number, m.ds.lightsOutMs),
          pit_stops: m.ds.pits.filter((p) => p.number === d.number).length,
          tyres: d.stints.map((s) => s.compound ?? "not published").join(" > "),
        };
      }),
      neutralised_periods: neutralisedPeriods(m).map((p) => ({ kind: p.kind, from_lap: this.lapOf(p.from), to_lap: this.lapOf(p.to), t: p.from, race_clock: this.clock(p.from) })),
      fastest_comparable_lap: fastest ? { driver: this.code(fastest.i), lap: fastest.lap, time_s: r3(fastest.s) } : null,
      weather: w
        ? { air_c: air.length ? [r1(Math.min(...air)), r1(Math.max(...air))] : null, track_c: track.length ? [r1(Math.min(...track)), r1(Math.max(...track))] : null, rain_reported: w.rain.some((r) => (r ?? 0) > 0) }
        : "not published",
      source: "OpenF1 (official order, gaps, laps, pit stops, stints, race control, weather), as exported. Gaps are the last published values.",
    };
  }

  driverRace(i: number) {
    const m = this.m;
    const d = m.ds.drivers[i];
    const rows = lapRows(m, i);
    const c = consistency(rows);
    const best = rows.filter((r) => r.lapS != null).sort((a, b) => (a.lapS as number) - (b.lapS as number))[0];
    return {
      driver: this.code(i),
      name: d.fullName,
      team: d.team,
      number: d.number,
      start_position: m.positionOf(d.number, m.ds.lightsOutMs),
      [this.partial ? "current_position" : "finish_position"]: m.positionOf(d.number, m.ds.durationMs),
      laps: rows.map((r) => {
        const end = r.start + (r.lapS ?? 0) * 1000;
        const iv = m.intervalAt(i, end);
        return {
          lap: r.lap,
          position_at_end: m.positionOf(d.number, end),
          gap_to_leader_s: r3(iv?.gap),
          laps_down: iv?.lapsDown || null,
          lap_time_s: r3(r.lapS),
          notes: [r.pit && "pit", ...r.neutralisedBy, r.lap === 1 && "lap 1"].filter(Boolean).join(", ") || null,
        };
      }),
      pit_stops: m.ds.pits.filter((p) => p.number === d.number).map((p) => ({ lap: p.lap, t: p.t, race_clock: this.clock(p.t), pit_lane_s: r1(p.laneS), stationary_s: r1(p.stopS) })),
      stints: stintsOf(m, i, rows).map((s) => ({
        compound: s.compound ?? "not published",
        laps: `${s.lapStart}-${s.lapEnd}`,
        tyre_age_at_start: s.ageAtStart,
        change_without_pit_record: s.pitMatched === false || undefined,
        degradation_s_per_lap_calc: s.fit ? { slope: r3(s.fit.slope), std_error: r3(s.fit.slopeSe), laps_used: s.fit.n, note: "calculated; includes fuel burn-off" } : "too few comparable laps",
      })),
      best_lap: best ? { lap: best.lap, time_s: r3(best.lapS) } : null,
      consistency_calc: c ? { mean_s: r3(c.meanS), std_dev_s: r3(c.sdS), laps: c.laps, note: "comparable laps only (no lap 1, pit, SC/VSC/red-flag laps)" } : null,
      race_control_about_driver: this.messages({ driver: i, keyOnly: false }).slice(0, 20),
    };
  }

  lapTimes(drivers: number[], from: number, to: number) {
    const m = this.m;
    return drivers.map((i) => ({
      driver: this.code(i),
      laps: lapRows(m, i)
        .filter((r) => r.lap >= from && r.lap <= to)
        .map((r) => ({ lap: r.lap, t: r.start, time_s: r3(r.lapS), sectors_s: r.sectors?.map(r3) ?? null, notes: [r.pit && "pit", ...r.neutralisedBy].filter(Boolean).join(", ") || null })),
    }));
  }

  /** Lap by lap: both positions and the time between the two cars (difference of their published gaps to the leader at each lap end of A). */
  battle(a: number, b: number) {
    const m = this.m;
    const na = m.ds.drivers[a].number;
    const nb = m.ds.drivers[b].number;
    return {
      a: this.code(a),
      b: this.code(b),
      note: "gap_b_minus_a_s > 0 means B was behind A. Calculated from the published gaps to the leader at the end of each of A's laps; null when either was lapped or a gap was missing.",
      laps: lapRows(m, a).map((r) => {
        const end = r.start + (r.lapS ?? 0) * 1000;
        const ga = m.intervalAt(a, end);
        const gb = m.intervalAt(b, end);
        const pa = m.positionOf(na, end);
        const pb = m.positionOf(nb, end);
        const g = (x: typeof ga, p: number | null) => (p === 1 ? 0 : x?.lapsDown ? null : (x?.gap ?? null));
        const A = g(ga, pa);
        const B = g(gb, pb);
        return { lap: r.lap, t: end, position_a: pa, position_b: pb, gap_b_minus_a_s: A != null && B != null ? r3(B - A) : null };
      }),
    };
  }

  messages(o: { fromLap?: number; toLap?: number; driver?: number; keyOnly?: boolean }) {
    const m = this.m;
    const num = o.driver != null ? m.ds.drivers[o.driver].number : null;
    return m.ds.raceControl
      .map(classify)
      .filter((c) => (o.keyOnly ? c.importance === "key" : c.importance !== "routine" || num != null))
      .filter((c) => num == null || c.number === num || new RegExp(`\\bCAR ${num}\\b`).test(c.message))
      .map((c) => ({ c, lap: c.lap ?? this.lapOf(c.t) }))
      .filter(({ lap }) => (o.fromLap == null || (lap ?? 0) >= o.fromLap) && (o.toLap == null || (lap ?? 0) <= o.toLap))
      .map(({ c, lap }) => ({ t: c.t, race_clock: this.clock(c.t), lap, kind: c.kind, message: messageText(c.message) }));
  }

  /** Race Rewind: every position change of a driver with its calculated cause (see lib/replay/rewind). */
  positionChanges(i: number) {
    const m = this.m;
    const steps = rewindSteps(m, i);
    const sum = rewindSummary(m, i, steps);
    const code = (n: number) => {
      const k = m.ds.drivers.findIndex((d) => d.number === n);
      return k >= 0 ? this.code(k) : `#${n}`;
    };
    return {
      driver: this.code(i),
      start_position: sum.start,
      [this.partial ? "current_position" : "finish_position"]: sum.now,
      net_places_by_cause_calc: sum.byCause,
      changes: steps.map((s) => ({
        t: s.t,
        race_clock: this.clock(s.t),
        lap: s.lap,
        from: s.from,
        to: s.to,
        swaps: s.swaps.map((w) => ({ car: code(w.other), cause: w.cause })),
        own_pit_stop: s.pit ? { lap: s.pit.lap, pit_lane_s: r1(s.pit.laneS) } : undefined,
        under: s.neutralised ?? undefined,
        penalty_messages: s.penalties.length ? s.penalties : undefined,
      })),
      note: "Calculated by APEX F1 from the official order, pit stops and OpenF1's published on-track passes. cause: own-pit (lost while pitting), rival-pit (gained as the other car pitted), on-track (a published pass), rival-stopped (the other car stopped), unexplained (no record explains it).",
    };
  }

  weather() {
    const w = this.m.ds.weather;
    if (!w) return { weather: "not published for this race" };
    // About one reading a minute: every fifth keeps the answer short.
    return {
      readings: w.t
        .map((t, i) => ({ t, race_clock: this.clock(t), lap: this.lapOf(t), air_c: r1(w.air[i]), track_c: w.track[i] === 0 ? null : r1(w.track[i]), humidity_pct: r1(w.humidity[i]), rain: w.rain[i] == null ? null : (w.rain[i] as number) > 0, wind_m_s: r1(w.windSpeed[i]) }))
        .filter((_, k) => k % 5 === 0),
      note: "Track-side station, about one reading a minute (every fifth shown). Track 0 C readings are sensor dropouts (null). Rain is on/off only.",
    };
  }
}

/** A tool for the model: name, what it does, and its input as JSON Schema. */
export interface ToolSpec {
  name: string;
  description: string;
  input_schema: Record<string, unknown>;
}

/** Tool definitions (stable order and text, so every request sends the same prefix). */
export const TOOLS: ToolSpec[] = [
  {
    name: "race_summary",
    description:
      "Overview of the selected race within the data scope: classification (or current order) with gaps, start positions, pit-stop counts and tyre sequences; Safety Car/VSC/red-flag periods; fastest comparable lap; weather range. Call this first for any question.",
    input_schema: { type: "object", properties: {}, additionalProperties: false },
  },
  {
    name: "driver_race",
    description:
      "One driver's race lap by lap: position and gap to the leader at each lap end, lap times with notes (pit, Safety Car, VSC, red flag), pit stops (pit-lane and stationary time), tyre stints with calculated degradation, best lap, consistency, and race-control messages about them.",
    input_schema: { type: "object", properties: { driver: { type: "string", description: "Three-letter code (e.g. NOR), car number or surname" } }, required: ["driver"], additionalProperties: false },
  },
  {
    name: "lap_times",
    description: "Official lap and sector times for up to 4 drivers over a lap range, with pit and neutralised-lap notes.",
    input_schema: {
      type: "object",
      properties: {
        drivers: { type: "array", items: { type: "string" }, description: "Codes, numbers or surnames (1-4)" },
        from_lap: { type: "integer" },
        to_lap: { type: "integer" },
      },
      required: ["drivers", "from_lap", "to_lap"],
      additionalProperties: false,
    },
  },
  {
    name: "battle",
    description: "Two drivers lap by lap: both positions and the time between them, to explain overtakes, undercuts and lost places.",
    input_schema: { type: "object", properties: { driver_a: { type: "string" }, driver_b: { type: "string" } }, required: ["driver_a", "driver_b"], additionalProperties: false },
  },
  {
    name: "race_control",
    description: "Race-control messages (flags, Safety Car, VSC, penalties, investigations, track limits), optionally for a lap range or one driver. key_only keeps the race-shaping ones.",
    input_schema: {
      type: "object",
      properties: { from_lap: { type: "integer" }, to_lap: { type: "integer" }, driver: { type: "string" }, key_only: { type: "boolean" } },
      additionalProperties: false,
    },
  },
  {
    name: "position_changes",
    description:
      "Race Rewind for one driver: every position change with its calculated cause (own pit stop, a rival's pit stop, an on-track pass, a rival stopping, or unexplained), whether it was under a Safety Car/VSC, penalty messages, and net places by cause. Use for 'why did X lose/gain places' questions.",
    input_schema: { type: "object", properties: { driver: { type: "string", description: "Three-letter code, car number or surname" } }, required: ["driver"], additionalProperties: false },
  },
  {
    name: "weather",
    description: "Track-side weather through the race (air and track temperature, humidity, rain, wind), about every five minutes.",
    input_schema: { type: "object", properties: {}, additionalProperties: false },
  },
];

export type ToolOutcome = { ok: true; value: unknown; label: string } | { ok: false; error: string };

const isInt = (v: unknown): v is number => Number.isInteger(v);
const isStr = (v: unknown): v is string => typeof v === "string" && v.length > 0 && v.length <= 40;

/** Runs one tool call. Inputs are model output, so each is validated here before use (unknown fields and wrong types are errors). */
export function runTool(data: EngineerData, name: string, input: unknown): ToolOutcome {
  const o = (input && typeof input === "object" ? input : {}) as Record<string, unknown>;
  const who = (q: unknown): number | string => {
    if (!isStr(q)) return "driver must be a code, number or surname";
    const i = data.driver(q);
    return i ?? `no single driver matches "${q}" in this race`;
  };
  switch (name) {
    case "race_summary":
      return { ok: true, value: data.summary(), label: "Race summary" };
    case "driver_race": {
      const i = who(o.driver);
      return typeof i === "string" ? { ok: false, error: i } : { ok: true, value: data.driverRace(i), label: `${data.code(i)}'s race` };
    }
    case "lap_times": {
      if (!Array.isArray(o.drivers) || o.drivers.length < 1 || o.drivers.length > 4) return { ok: false, error: "drivers must list 1-4 drivers" };
      if (!isInt(o.from_lap) || !isInt(o.to_lap) || o.from_lap > o.to_lap) return { ok: false, error: "from_lap and to_lap must be whole lap numbers, from <= to" };
      const ids = o.drivers.map(who);
      const bad = ids.find((x) => typeof x === "string");
      if (bad != null) return { ok: false, error: bad as string };
      const is = ids as number[];
      return { ok: true, value: data.lapTimes(is, o.from_lap, o.to_lap), label: `Lap times ${is.map((i) => data.code(i)).join(", ")}, laps ${o.from_lap}-${o.to_lap}` };
    }
    case "battle": {
      const a = who(o.driver_a);
      const b = who(o.driver_b);
      if (typeof a === "string") return { ok: false, error: a };
      if (typeof b === "string") return { ok: false, error: b };
      return { ok: true, value: data.battle(a, b), label: `${data.code(a)} vs ${data.code(b)}` };
    }
    case "race_control": {
      if ((o.from_lap != null && !isInt(o.from_lap)) || (o.to_lap != null && !isInt(o.to_lap))) return { ok: false, error: "laps must be whole numbers" };
      let driver: number | undefined;
      if (o.driver != null) {
        const i = who(o.driver);
        if (typeof i === "string") return { ok: false, error: i };
        driver = i;
      }
      const list = data.messages({ fromLap: o.from_lap as number | undefined, toLap: o.to_lap as number | undefined, driver, keyOnly: o.key_only === true });
      return { ok: true, value: { messages: list.slice(0, 80), truncated: list.length > 80 || undefined }, label: driver != null ? `Race control about ${data.code(driver)}` : "Race control" };
    }
    case "position_changes": {
      const i = who(o.driver);
      return typeof i === "string" ? { ok: false, error: i } : { ok: true, value: data.positionChanges(i), label: `${data.code(i)}'s position changes` };
    }
    case "weather":
      return { ok: true, value: data.weather(), label: "Weather" };
    default:
      return { ok: false, error: `unknown tool ${name}` };
  }
}

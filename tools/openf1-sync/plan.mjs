// Pure planning for the OpenF1 sync worker: which datasets to (re)build, given OpenF1's session list, what is already stored, and the time.
// No I/O here, so the rules are tested directly (plan.test.mjs).

export const DEFAULTS = {
  /** A session is first synced this long after it ends: OpenF1 publishes results "a few minutes after" the official ones. */
  settleMs: 90 * 60_000,
  /** ...and re-synced once, bypassing the response cache, this long after it ends (late corrections, penalties), then left alone. */
  finalizeMs: 26 * 3_600_000,
};

const ended = (s) => Date.parse(s.date_end);

/**
 * @param {object} p
 * @param {{session_key:number, session_name:string, date_end:string, year:number}[]} p.sessions OpenF1 /sessions rows for the synced years
 * @param {{replay?:Record<string,{final?:boolean}>, telemetry?:Record<string,{final?:boolean}>}} p.state what the worker already stored
 * @param {Set<number>} p.bundled session keys shipped with the site's build (already final; not re-downloaded)
 * @param {number} p.now
 * @returns {{kind:"replay"|"results"|"telemetry", year:number, sessionKey?:number, sessionKeys?:number[], fresh:boolean, reason:string}[]}
 */
export function planSync({ sessions, state, bundled, now, settleMs = DEFAULTS.settleMs, finalizeMs = DEFAULTS.finalizeMs }) {
  const jobs = [];
  const stage = (s, stored) => {
    const end = ended(s);
    if (!Number.isFinite(end) || now < end + settleMs) return null; // not finished, or too recent to be complete
    if (bundled.has(s.session_key)) return null;
    if (!stored) return { fresh: false, reason: "new" };
    if (!stored.final && now >= end + finalizeMs) return { fresh: true, reason: "finalize" };
    return null;
  };
  const touched = new Map(); // year -> { fresh }
  const touch = (year, fresh) => touched.set(year, { fresh: (touched.get(year)?.fresh ?? false) || fresh });

  for (const s of [...sessions].sort((a, b) => ended(a) - ended(b))) {
    if (s.session_name === "Race") {
      const st = stage(s, state.replay?.[s.session_key]);
      if (st) {
        jobs.push({ kind: "replay", year: s.year, sessionKey: s.session_key, ...st });
        touch(s.year, st.fresh);
      }
    }
  }
  // Telemetry covers qualifying and race fastest laps; one export per year, for the sessions that need it.
  const tele = new Map();
  for (const s of sessions) {
    if (s.session_name !== "Race" && s.session_name !== "Qualifying") continue;
    const st = stage(s, state.telemetry?.[s.session_key]);
    if (!st) continue;
    const t = tele.get(s.year) ?? { sessionKeys: [], fresh: false };
    t.sessionKeys.push(s.session_key);
    t.fresh ||= st.fresh;
    tele.set(s.year, t);
  }
  for (const [year, t] of tele) jobs.push({ kind: "telemetry", year, sessionKeys: t.sessionKeys.sort((a, b) => a - b), fresh: t.fresh, reason: t.fresh ? "finalize" : "new" });
  // Season results and standings change when a race is added or finalised: rebuilt when a race is synced in this run, or when a stored
  // race is newer than the stored results (a run interrupted between the two must not leave the standings behind).
  for (const r of Object.values(state.replay ?? {})) {
    const res = state.results?.[r.year];
    if (r.syncedAt && (!res?.syncedAt || res.syncedAt < r.syncedAt) && !touched.has(r.year)) touch(r.year, false);
  }
  for (const [year, { fresh }] of touched) jobs.push({ kind: "results", year, fresh, reason: fresh ? "finalize" : "new race" });
  return jobs;
}

/** Whether a stored session is final (synced late enough that later corrections are unlikely). */
export const isFinal = (dateEnd, syncedAt, finalizeMs = DEFAULTS.finalizeMs) => syncedAt >= Date.parse(dateEnd) + finalizeMs;

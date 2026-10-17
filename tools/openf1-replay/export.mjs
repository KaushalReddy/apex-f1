#!/usr/bin/env node
// Exports full-race replay datasets from OpenF1 (https://openf1.org) for the Race Replay (apps/web/public/replay/<year>/<sessionKey>.json),
// served by the site and loaded one race at a time. The app never calls OpenF1.
//
//   node tools/openf1-replay/export.mjs --year 2026 --out apps/web/public/replay/2026 [--sessions 11388,11731]
//
// Everything is SOURCE data as published, with one reduction: car positions (about 3.7 Hz) are thinned to recorded samples at least
// MIN_STEP_MS apart (samples are dropped, never synthesised) and delta-encoded. Running order (/position), gaps (/intervals), laps,
// pit stops and race-control messages are kept as published. Interpolation between samples happens in the app and is labelled there.
import { mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { ms, openf1 } from "../openf1-client.mjs";

const args = Object.fromEntries(process.argv.slice(2).reduce((acc, a, i, all) => (a.startsWith("--") ? [...acc, [a.slice(2), all[i + 1]]] : acc), []));
const year = Number(args.year);
const out = args.out;
const only = args.sessions ? new Set(args.sessions.split(",").map(Number)) : null;
if (!Number.isInteger(year) || !out) {
  console.error("usage: node export.mjs --year <yyyy> --out <dir> [--sessions <key,key>]");
  process.exit(2);
}
const get = openf1(join(dirname(fileURLToPath(import.meta.url)), ".cache"));
const iso = (t) => new Date(t).toISOString();
/** Keep recorded position samples at least this far apart (ms). */
const MIN_STEP_MS = 1000;
/** Replay window: from shortly before lights-out to shortly after the last car finishes its final lap. */
const LEAD_IN_MS = 20_000;
const TAIL_MS = 30_000;
const WINDOW_MS = 30 * 60_000; // OpenF1 /location request window
const num = (v) => (typeof v === "number" && Number.isFinite(v) ? v : null);
const lapsDown = (v) => (typeof v === "string" && /^\+(\d+) LAPS?$/i.test(v) ? Number(/\d+/.exec(v)[0]) : null);

const sessions = (await get(`sessions?year=${year}`))
  .filter((s) => s.session_name === "Race" && ms(s.date_end) < Date.now() && (!only || only.has(s.session_key)))
  .sort((a, b) => ms(a.date_start) - ms(b.date_start));
const meetings = new Map((await get(`meetings?year=${year}`)).map((m) => [m.meeting_key, m]));
mkdirSync(out, { recursive: true });

for (const s of sessions) {
  const key = s.session_key;
  const [laps, ids, rc, order, intervals, pits] = [
    await get(`laps?session_key=${key}`),
    await get(`drivers?session_key=${key}`),
    await get(`race_control?session_key=${key}`),
    await get(`position?session_key=${key}`),
    await get(`intervals?session_key=${key}`),
    await get(`pit?session_key=${key}`),
  ];
  const weather = (await get(`weather?session_key=${key}`)).sort((x, y) => ms(x.date) - ms(y.date));
  const stints = await get(`stints?session_key=${key}`);
  const overtakes = await get(`overtakes?session_key=${key}`);
  const lap1 = laps.filter((l) => l.lap_number === 1 && l.date_start).map((l) => ms(l.date_start));
  if (!lap1.length) {
    console.error(`  ${key} ${s.location}: no lap data published, skipped`);
    continue;
  }
  const lightsOut = Math.min(...lap1);
  const lapEnds = laps.filter((l) => l.date_start && l.lap_duration).map((l) => ms(l.date_start) + l.lap_duration * 1000);
  const start = lightsOut - LEAD_IN_MS;
  const end = Math.max(...lapEnds) + TAIL_MS;
  const rel = (iso) => ms(iso) - start;

  const drivers = [];
  for (const d of ids.sort((a, b) => a.driver_number - b.driver_number)) {
    const n = d.driver_number;
    const rows = [];
    for (let w = start; w < end; w += WINDOW_MS) {
      rows.push(...(await get(`location?session_key=${key}&driver_number=${n}&date>=${iso(w)}&date<${iso(Math.min(end, w + WINDOW_MS))}`)));
    }
    // Numeric order, duplicates removed, (0,0,0) rows dropped ("no fix" in this feed), then thinned to MIN_STEP_MS.
    const clean = rows
      .filter((r) => Number.isFinite(r.x) && Number.isFinite(r.y) && !(r.x === 0 && r.y === 0 && r.z === 0))
      .map((r) => ({ t: rel(r.date), x: r.x, y: r.y }))
      .sort((a, b) => a.t - b.t);
    const kept = [];
    for (const r of clean) if (!kept.length || r.t - kept[kept.length - 1].t >= MIN_STEP_MS) kept.push(r);
    const delta = (k) => kept.map((r, i) => (i === 0 ? r[k] : r[k] - kept[i - 1][k]));
    const dl = laps
      .filter((l) => l.driver_number === n && l.date_start)
      .sort((a, b) => a.lap_number - b.lap_number)
      .map((l) => [l.lap_number, rel(l.date_start), num(l.lap_duration), num(l.duration_sector_1), num(l.duration_sector_2), num(l.duration_sector_3)]);
    const iv = intervals
      .filter((r) => r.driver_number === n)
      .map((r) => ({ t: rel(r.date), gap: num(r.gap_to_leader), int: num(r.interval), down: lapsDown(r.gap_to_leader) }))
      .sort((a, b) => a.t - b.t);
    drivers.push({
      number: n,
      acronym: d.name_acronym ?? null,
      fullName: d.full_name ?? null,
      team: d.team_name ?? null,
      teamColour: d.team_colour ? `#${d.team_colour.toLowerCase()}` : null,
      // Delta-encoded recorded samples: t (ms from the replay start), x, y (OpenF1 location units).
      positions: { dt: delta("t"), dx: delta("x"), dy: delta("y") },
      laps: dl,
      intervals: { t: iv.map((r) => r.t), gap: iv.map((r) => r.gap), interval: iv.map((r) => r.int), lapsDown: iv.map((r) => r.down) },
      // Tyre stints as published: [stint number, compound, first lap, last lap, tyre age (laps) at the start].
      stints: stints
        .filter((x) => x.driver_number === n)
        .sort((a, b) => a.stint_number - b.stint_number)
        .map((x) => [x.stint_number, x.compound ?? null, x.lap_start ?? null, x.lap_end ?? null, x.tyre_age_at_start ?? null]),
    });
  }
  const m = meetings.get(s.meeting_key) ?? {};
  const doc = {
    schema: "apex-f1/race-replay@1",
    source: {
      name: "OpenF1",
      url: "https://openf1.org",
      endpoints: ["/v1/sessions", "/v1/meetings", "/v1/drivers", "/v1/location", "/v1/laps", "/v1/position", "/v1/intervals", "/v1/pit", "/v1/race_control", "/v1/weather", "/v1/stints", "/v1/overtakes"],
      fetchedOn: new Date().toISOString().slice(0, 10),
      note: "Recorded OpenF1 data (unofficial, community API; data originating from Formula 1 timing). Positions thinned to samples at least 1 s apart. Non-commercial use; see openf1.org for terms.",
    },
    season: year,
    meetingKey: s.meeting_key,
    sessionKey: key,
    eventName: m.meeting_name ?? s.location,
    circuitShortName: s.circuit_short_name ?? null,
    date: s.date_start.slice(0, 10),
    coordinateSystem: "openf1-location",
    startUtc: iso(start),
    lightsOutMs: lightsOut - start,
    durationMs: end - start,
    positionStepMs: MIN_STEP_MS,
    drivers,
    // Official running-order changes as published: [t, car number, position].
    order: order
      .filter((r) => Number.isInteger(r.position))
      .map((r) => [rel(r.date), r.driver_number, r.position])
      .sort((a, b) => a[0] - b[0]),
    pits: pits
      .filter((p) => p.date)
      .map((p) => ({ t: rel(p.date), number: p.driver_number, lap: p.lap_number ?? null, laneS: num(p.lane_duration ?? p.pit_duration), stopS: num(p.stop_duration) }))
      .sort((a, b) => a.t - b.t),
    // Weather station readings (about one a minute) as published: °C, %, hPa, m/s, degrees; rainfall 0/1.
    weather: {
      t: weather.map((w) => rel(w.date)),
      air: weather.map((w) => num(w.air_temperature)),
      track: weather.map((w) => num(w.track_temperature)),
      humidity: weather.map((w) => num(w.humidity)),
      pressure: weather.map((w) => num(w.pressure)),
      rain: weather.map((w) => num(w.rainfall)),
      windSpeed: weather.map((w) => num(w.wind_speed)),
      windDir: weather.map((w) => num(w.wind_direction)),
    },
    // On-track passes as published: [t, overtaking car, overtaken car, position gained].
    overtakes: overtakes
      .filter((o) => o.date && Number.isInteger(o.overtaking_driver_number) && Number.isInteger(o.overtaken_driver_number))
      .map((o) => [rel(o.date), o.overtaking_driver_number, o.overtaken_driver_number, o.position ?? null])
      .sort((a, b) => a[0] - b[0]),
    raceControl: rc
      .map((r) => ({ t: rel(r.date), category: r.category ?? null, flag: r.flag ?? null, scope: r.scope ?? null, message: r.message ?? "", lap: r.lap_number ?? null, number: r.driver_number ?? null }))
      .sort((a, b) => a.t - b.t),
  };
  writeFileSync(join(out, `${key}.json`), JSON.stringify(doc));
  console.error(`  ${key} ${doc.eventName}: ${drivers.length} drivers, ${drivers.reduce((n, d) => n + d.positions.dt.length, 0)} position samples, ${(JSON.stringify(doc).length / 1e6).toFixed(1)} MB`);
}

/**
 * Share of the race window covered by recorded positions: for each car, the time from its first to last sample, counting only gaps of at
 * most 5 s (what the app will interpolate); the median over cars, as a fraction of the window. 1 = complete; OpenF1 sometimes stops
 * publishing positions part-way (e.g. Monaco 2026).
 */
function coverage(d) {
  const spans = d.drivers.map((x) => {
    let covered = 0;
    x.positions.dt.forEach((v, i) => {
      if (i > 0 && v <= 5000) covered += v;
    });
    return covered;
  });
  spans.sort((a, b) => a - b);
  return spans.length ? Math.round((spans[Math.floor(spans.length / 2)] / d.durationMs) * 1000) / 1000 : 0;
}

const index = readdirSync(out)
  .filter((f) => /^\d+\.json$/.test(f))
  .map((f) => JSON.parse(readFileSync(join(out, f), "utf8")))
  .map((d) => ({ sessionKey: d.sessionKey, meetingKey: d.meetingKey, eventName: d.eventName, circuitShortName: d.circuitShortName, date: d.date, durationMs: d.durationMs, drivers: d.drivers.length, laps: Math.max(0, ...d.drivers.flatMap((x) => x.laps.map((l) => l[0]))), positionCoverage: coverage(d) }))
  .sort((a, b) => a.date.localeCompare(b.date));
writeFileSync(join(out, "index.json"), JSON.stringify({ schema: "apex-f1/race-replay-index@1", season: year, sessions: index }, null, 1) + "\n");
console.error(`wrote ${index.length} replays to ${out}`);

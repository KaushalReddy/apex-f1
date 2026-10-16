#!/usr/bin/env node
// Exports each driver's fastest valid lap of every completed Qualifying and Race session in a season from OpenF1 (https://openf1.org):
// the car telemetry samples (speed, throttle, brake, RPM, gear) and the car's position samples over that lap. The web app's Telemetry Lab
// reads these files at request time (apps/web/src/data/telemetry/<year>/<sessionKey>.json); it never calls OpenF1.
//
//   node tools/openf1-telemetry/export.mjs --year 2026 --out apps/web/src/data/telemetry/2026
//
// Nothing is computed or filled in here: samples are written as published (times relative to the lap's start), so distance, deltas and
// interpolation are derived (and tested) in the app. A lap whose time race control deleted (track limits etc.) is never chosen as the
// fastest lap; deletions are read from OpenF1 /race_control and listed in the file. Requests are rate-limited and retried like
// tools/openf1-results.
import { mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { ms, openf1 } from "../openf1-client.mjs";

const args = Object.fromEntries(process.argv.slice(2).reduce((acc, a, i, all) => (a.startsWith("--") ? [...acc, [a.slice(2), all[i + 1]]] : acc), []));
const year = Number(args.year);
const out = args.out;
const SESSIONS = (args.sessions ?? "Qualifying,Race").split(",");
if (!Number.isInteger(year) || !out) {
  console.error("usage: node export.mjs --year <yyyy> --out <dir> [--sessions Qualifying,Race]");
  process.exit(2);
}

const get = openf1(join(dirname(fileURLToPath(import.meta.url)), ".cache"));

const iso = (t) => new Date(t).toISOString();
/** Padding either side of the lap so the app can interpolate exactly at the start and finish line. */
const PAD_MS = 1000;

/** (driver, lap) pairs whose lap time race control deleted, after any later reinstatement. */
function deletedLaps(messages) {
  const deleted = new Map();
  for (const m of [...messages].sort((a, b) => ms(a.date) - ms(b.date))) {
    const hit = /CAR (\d+)\b.*?\bTIME [\d:.]+ (DELETED|REINSTATED)\b.*?\bLAP (\d+)/.exec(m.message ?? "");
    if (!hit) continue;
    const key = `${hit[1]}:${hit[3]}`;
    if (hit[2] === "DELETED") deleted.set(key, m.message);
    else deleted.delete(key);
  }
  return deleted;
}

const sessions = (await get(`sessions?year=${year}`))
  .filter((s) => SESSIONS.includes(s.session_name) && ms(s.date_end) < Date.now())
  .sort((a, b) => a.date_start.localeCompare(b.date_start));
const meetings = new Map((await get(`meetings?year=${year}`)).map((m) => [m.meeting_key, m]));
mkdirSync(out, { recursive: true });

for (const s of sessions) {
  const target = join(out, `${s.session_key}.json`);
  const [laps, ids, rc] = [await get(`laps?session_key=${s.session_key}`), await get(`drivers?session_key=${s.session_key}`), await get(`race_control?session_key=${s.session_key}`)];
  if (!laps.length) {
    console.error(`  ${s.session_key} ${s.location} ${s.session_name}: no laps published, skipped`);
    continue;
  }
  const deleted = deletedLaps(rc);
  const byDriver = new Map();
  const excluded = [];
  for (const l of laps) {
    if (!l.lap_duration || !l.date_start || l.is_pit_out_lap) continue;
    const why = deleted.get(`${l.driver_number}:${l.lap_number}`);
    if (why) {
      excluded.push({ driverNumber: l.driver_number, lapNumber: l.lap_number, lapDuration: l.lap_duration, reason: why });
      continue;
    }
    const best = byDriver.get(l.driver_number);
    if (!best || l.lap_duration < best.lap_duration) byDriver.set(l.driver_number, l);
  }
  const out_laps = [];
  for (const [n, l] of [...byDriver].sort((a, b) => a[1].lap_duration - b[1].lap_duration)) {
    const t0 = ms(l.date_start);
    const window = `session_key=${s.session_key}&driver_number=${n}&date>=${iso(t0 - PAD_MS)}&date<=${iso(t0 + l.lap_duration * 1000 + PAD_MS)}`;
    // Numeric sort: OpenF1 omits the fraction on whole seconds ("…:41+00:00"), which string/locale ordering puts after "…:41.280…".
    const car = (await get(`car_data?${window}`)).sort((a, b) => ms(a.date) - ms(b.date));
    const pos = (await get(`location?${window}`)).sort((a, b) => ms(a.date) - ms(b.date));
    const id = ids.find((d) => d.driver_number === n);
    out_laps.push({
      driverNumber: n,
      acronym: id?.name_acronym ?? null,
      fullName: id?.full_name ?? null,
      team: id?.team_name ?? null,
      teamColour: id?.team_colour ? `#${id.team_colour.toLowerCase()}` : null,
      lapNumber: l.lap_number,
      lapDuration: l.lap_duration,
      sectors: [l.duration_sector_1 ?? null, l.duration_sector_2 ?? null, l.duration_sector_3 ?? null],
      car: {
        t: car.map((r) => ms(r.date) - t0),
        speed: car.map((r) => r.speed ?? null),
        throttle: car.map((r) => r.throttle ?? null),
        brake: car.map((r) => r.brake ?? null),
        rpm: car.map((r) => r.rpm ?? null),
        gear: car.map((r) => r.n_gear ?? null),
      },
      position: { t: pos.map((r) => ms(r.date) - t0), x: pos.map((r) => r.x), y: pos.map((r) => r.y) },
    });
  }
  const m = meetings.get(s.meeting_key) ?? {};
  const doc = {
    schema: "apex-f1/lap-telemetry@1",
    source: {
      name: "OpenF1",
      url: "https://openf1.org",
      endpoints: ["/v1/sessions", "/v1/meetings", "/v1/laps", "/v1/drivers", "/v1/race_control", "/v1/car_data", "/v1/location"],
      fetchedOn: new Date().toISOString().slice(0, 10),
      note: "Car telemetry (about 4 Hz) and position samples as published by OpenF1 (unofficial, community API; data originates from Formula 1 timing). Non-commercial use; see openf1.org for terms.",
    },
    season: year,
    meetingKey: s.meeting_key,
    sessionKey: s.session_key,
    sessionName: s.session_name,
    eventName: m.meeting_name ?? s.location,
    circuitShortName: s.circuit_short_name ?? null,
    date: s.date_start.slice(0, 10),
    coordinateSystem: "openf1-location",
    lapSelection: "Each driver's fastest timed lap in the session, excluding pit-out laps and laps whose time race control deleted.",
    laps: out_laps,
    excluded,
  };
  writeFileSync(target, JSON.stringify(doc) + "\n");
  console.error(`  ${s.session_key} ${doc.eventName} ${s.session_name}: ${out_laps.length} laps, ${excluded.length} deleted laps excluded`);
}

// Index of every exported session in the folder (what the lab lists without opening each file).
const index = readdirSync(out)
  .filter((f) => /^\d+\.json$/.test(f))
  .map((f) => JSON.parse(readFileSync(join(out, f), "utf8")))
  .map((d) => ({ sessionKey: d.sessionKey, meetingKey: d.meetingKey, sessionName: d.sessionName, eventName: d.eventName, circuitShortName: d.circuitShortName, date: d.date, drivers: d.laps.length, acronyms: d.laps.map((l) => l.acronym).filter(Boolean) }))
  .sort((a, b) => a.date.localeCompare(b.date) || a.sessionName.localeCompare(b.sessionName));
writeFileSync(join(out, "index.json"), JSON.stringify({ schema: "apex-f1/lap-telemetry-index@1", season: year, sessions: index }, null, 1) + "\n");
console.error(`wrote ${index.length} sessions to ${out}`);

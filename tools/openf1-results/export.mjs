#!/usr/bin/env node
// Exports one season of official session classifications from OpenF1 (https://openf1.org) into a deterministic JSON snapshot that the
// web app reads at build time (apps/web/src/data/results/<year>.json). The app never calls OpenF1 at runtime.
//
//   node tools/openf1-results/export.mjs --year 2025 --out apps/web/src/data/results/2025.json
//
// What is exported, per completed race weekend: the race and sprint classifications (position, points, DNF/DNS/DSQ flags, laps), the
// qualifying classification (position only) and the drivers' and constructors' championship standings after the race, plus each driver's identity and team
// as OpenF1 reports them for that session. Nothing is computed or filled in here: a value OpenF1 does not provide is written as null.
// Requests are rate-limited (OpenF1's free tier) and retried on 429/5xx.
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const API = "https://api.openf1.org/v1";
const args = Object.fromEntries(process.argv.slice(2).reduce((acc, a, i, all) => (a.startsWith("--") ? [...acc, [a.slice(2), all[i + 1]]] : acc), []));
const year = Number(args.year);
const out = args.out;
if (!Number.isInteger(year) || !out) {
  console.error("usage: node export.mjs --year <yyyy> --out <file>");
  process.exit(2);
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
// Response cache (gitignored): an interrupted export resumes without re-fetching. Completed sessions do not change, but delete the cache to
// pick up later corrections by the source.
const CACHE = join(dirname(fileURLToPath(import.meta.url)), ".cache");
mkdirSync(CACHE, { recursive: true });
let last = 0;
async function get(path) {
  const file = join(CACHE, createHash("sha1").update(path).digest("hex") + ".json");
  if (existsSync(file)) return JSON.parse(readFileSync(file, "utf8"));
  const body = await fetchJson(path);
  // Do not cache answers for sessions that may still be updated (the current season's latest data is re-fetched on the next run).
  if (body.length) writeFileSync(file, JSON.stringify(body));
  return body;
}
async function fetchJson(path) {
  for (let attempt = 0; attempt < 8; attempt++) {
    const wait = Math.max(0, last + 2100 - Date.now());
    if (wait) await sleep(wait);
    last = Date.now();
    const res = await fetch(`${API}/${path}`);
    if (res.status === 404) return [];
    if (res.ok) {
      const body = await res.json();
      return Array.isArray(body) ? body : [];
    }
    if (res.status === 429 || res.status >= 500) {
      await sleep(8000 * (attempt + 1));
      continue;
    }
    throw new Error(`${path}: HTTP ${res.status}`);
  }
  throw new Error(`${path}: gave up after retries`);
}

const now = Date.now();
const day = (iso) => iso.slice(0, 10);
// OpenF1 occasionally publishes a position as text (e.g. "RT" = retired in qualifying). Positions must be integers; text becomes a status.
const TEXT_STATUS = { RT: "DNF", DNF: "DNF", DQ: "DSQ", DSQ: "DSQ", DNS: "DNS", NC: "NC" };
const position = (r) => (Number.isInteger(r.position) ? r.position : null);
const status = (r) =>
  r.dsq ? "DSQ" : r.dns ? "DNS" : r.dnf ? "DNF" : position(r) == null ? (typeof r.position === "string" ? TEXT_STATUS[r.position.toUpperCase()] ?? "NC" : "NC") : "FIN";
const drivers = new Map(); // acronym -> identity
const idCache = new Map();

async function identities(sessionKey) {
  if (idCache.has(sessionKey)) return idCache.get(sessionKey);
  const rows = await get(`drivers?session_key=${sessionKey}`);
  const byNumber = new Map();
  for (const d of rows) {
    if (!d.name_acronym) continue;
    byNumber.set(d.driver_number, d);
    const known = drivers.get(d.name_acronym) ?? { acronym: d.name_acronym, fullName: null, firstName: null, lastName: null, countryCode: null, numbers: new Set(), teams: new Map() };
    known.fullName = d.full_name ?? known.fullName;
    known.firstName = d.first_name ?? known.firstName;
    known.lastName = d.last_name ?? known.lastName;
    known.countryCode = d.country_code ?? known.countryCode;
    known.numbers.add(d.driver_number);
    if (d.team_name) known.teams.set(d.team_name, d.team_colour ? `#${d.team_colour.toLowerCase()}` : null);
    drivers.set(d.name_acronym, known);
  }
  idCache.set(sessionKey, byNumber);
  return byNumber;
}

async function classification(session, withPoints) {
  if (!session) return null;
  const [rows, ids] = [await get(`session_result?session_key=${session.session_key}`), await identities(session.session_key)];
  if (rows.length === 0) return null;
  const results = rows
    .map((r) => {
      const id = ids.get(r.driver_number);
      const row = { acronym: id?.name_acronym ?? `#${r.driver_number}`, number: r.driver_number, team: id?.team_name ?? null, position: position(r), status: status(r) };
      if (withPoints) Object.assign(row, { points: r.points ?? null, laps: r.number_of_laps ?? null });
      return row;
    })
    .sort((a, b) => (a.position ?? 999) - (b.position ?? 999) || a.number - b.number);
  return { sessionKey: session.session_key, date: day(session.date_start), results };
}

const sessions = (await get(`sessions?year=${year}`)).filter((s) => ["Race", "Sprint", "Qualifying"].includes(s.session_name));
const meetings = new Map((await get(`meetings?year=${year}`)).map((m) => [m.meeting_key, m]));
const races = sessions.filter((s) => s.session_name === "Race").sort((a, b) => a.date_start.localeCompare(b.date_start));
const events = [];
const skipped = []; // past race dates with no published classification: recorded, never filled in
for (const [i, race] of races.entries()) {
  if (Date.parse(race.date_end) > now) continue; // not run yet
  const m = meetings.get(race.meeting_key) ?? {};
  const inMeeting = (name) => sessions.find((s) => s.meeting_key === race.meeting_key && s.session_name === name);
  const raceResult = await classification(race, true);
  if (!raceResult) {
    skipped.push({ round: i + 1, name: m.meeting_name ?? race.location, date: day(race.date_start), reason: "No race classification published by the source" });
    continue;
  }
  const standingsRows = await get(`championship_drivers?session_key=${race.session_key}`);
  const teamRows = await get(`championship_teams?session_key=${race.session_key}`);
  const ids = await identities(race.session_key);
  events.push({
    round: i + 1,
    meetingKey: race.meeting_key,
    name: m.meeting_name ?? race.location,
    location: race.location ?? m.location ?? null,
    countryCode: race.country_code ?? m.country_code ?? null,
    circuitShortName: race.circuit_short_name ?? m.circuit_short_name ?? null,
    date: day(race.date_start),
    race: raceResult,
    sprint: await classification(inMeeting("Sprint"), true),
    qualifying: await classification(inMeeting("Qualifying"), false),
    standings: standingsRows.length
      ? standingsRows
          .map((r) => ({ acronym: ids.get(r.driver_number)?.name_acronym ?? `#${r.driver_number}`, position: r.position_current ?? null, points: r.points_current ?? null }))
          .sort((a, b) => (a.position ?? 999) - (b.position ?? 999) || a.acronym.localeCompare(b.acronym))
      : null,
    teamStandings: teamRows.length
      ? teamRows
          .map((r) => ({ team: r.team_name ?? null, position: r.position_current ?? null, points: r.points_current ?? null }))
          .filter((r) => r.team)
          .sort((a, b) => (a.position ?? 999) - (b.position ?? 999) || a.team.localeCompare(b.team))
      : null,
  });
  console.error(`  round ${i + 1} ${m.meeting_name ?? race.location}: ${raceResult.results.length} classified rows`);
}

// A car can appear in the standings (or a classification) for an event whose identity list does not include it (e.g. a driver who missed
// that race still holds championship points). Resolve such "#<number>" keys through the season's identities; numbers are unique within a
// season. Anything still unresolved stays as "#<number>".
const byNumber = new Map();
for (const d of drivers.values()) for (const n of d.numbers) byNumber.set(n, byNumber.has(n) && byNumber.get(n) !== d.acronym ? null : d.acronym);
const resolve = (key) => (key.startsWith("#") ? byNumber.get(Number(key.slice(1))) ?? key : key);
for (const e of events) {
  for (const s of [e.race, e.sprint, e.qualifying]) if (s) for (const r of s.results) r.acronym = resolve(r.acronym);
  if (e.standings) for (const st of e.standings) st.acronym = resolve(st.acronym);
}

const doc = {
  schema: "apex-f1/season-results@1",
  season: year,
  source: {
    name: "OpenF1",
    url: "https://openf1.org",
    endpoints: ["/v1/sessions", "/v1/meetings", "/v1/session_result", "/v1/drivers", "/v1/championship_drivers", "/v1/championship_teams"],
    fetchedOn: day(new Date().toISOString()),
    note: "Official session classifications and championship standings as published by OpenF1 (unofficial, community API; data originates from Formula 1 timing). Non-commercial use; see openf1.org for terms.",
  },
  scheduledRaces: races.length,
  complete: races.every((r) => Date.parse(r.date_end) <= now),
  events,
  skipped,
  drivers: [...drivers.values()]
    .map((d) => ({ ...d, numbers: [...d.numbers].sort((a, b) => a - b), teams: [...d.teams].map(([name, colour]) => ({ name, colour })) }))
    .sort((a, b) => a.acronym.localeCompare(b.acronym)),
};
mkdirSync(dirname(out), { recursive: true });
writeFileSync(out, JSON.stringify(doc) + "\n");
console.error(`wrote ${out}: ${events.length}/${races.length} races, ${doc.drivers.length} drivers`);

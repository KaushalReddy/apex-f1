import { createTrackPath } from "@/lib/race/track";

/**
 * TEST DATA (synthetic, not a real race): two cars on a circular "circuit" of radius 1000 (world = source plane), one lap per 100 s for
 * car 1 and per 110 s for car 2, recorded every 1 s from t = 0 (lights out at 10 s).
 */
export const R = 1000;
const N = 720;
const ring = new Float32Array(N * 3);
for (let i = 0; i < N; i++) [ring[i * 3], ring[i * 3 + 1], ring[i * 3 + 2]] = [R * Math.cos((2 * Math.PI * i) / N), 0, R * Math.sin((2 * Math.PI * i) / N)];
const path = createTrackPath(ring);
export const project = (x: number, y: number, hint: number | null) => path.project(x, y, hint);

function track(lapS: number, untilS: number, skip: (s: number) => boolean = () => false) {
  const pts: [number, number, number][] = [];
  for (let s = 0; s <= untilS; s++) if (!skip(s)) pts.push([s * 1000, R * Math.cos((2 * Math.PI * s) / lapS), R * Math.sin((2 * Math.PI * s) / lapS)]);
  const delta = (k: number) => pts.map((p, i) => (i === 0 ? p[k] : p[k] - pts[i - 1][k]));
  return { dt: delta(0), dx: delta(1), dy: delta(2) };
}
export const fixture = () => ({
  schema: "apex-f1/race-replay@1",
  season: 2026, meetingKey: 1, sessionKey: 99, eventName: "Test GP", circuitShortName: "Test", date: "2026-01-01", coordinateSystem: "openf1-location",
  startUtc: "2026-01-01T12:00:00Z", lightsOutMs: 10_000, durationMs: 400_000, positionStepMs: 1000, source: {},
  drivers: [
    { number: 1, acronym: "AAA", team: "Team A", teamColour: "#112233", positions: track(100, 300), laps: [[1, 10_000, 100], [2, 110_000, 100], [3, 210_000, 100]], intervals: { t: [20_000, 120_000], gap: [0, 0], interval: [null, null], lapsDown: [null, null] } },
    // Car 2 has a 20 s hole in its recorded positions (150–170 s).
    { number: 2, acronym: "BBB", team: "Team B", teamColour: "#445566", positions: track(110, 300, (s) => s > 150 && s < 170), laps: [[1, 10_000, 110], [2, 120_000, null]], intervals: { t: [20_000, 120_000], gap: [0.4, 10.2], interval: [0.4, 10.2], lapsDown: [null, null] } },
    { number: 2, acronym: "DUP", positions: track(100, 10), laps: [], intervals: {} }, // duplicated identity: dropped, never merged
  ],
  order: [[0, 1, 1], [0, 2, 2], [15_000, 2, 1], [15_000, 1, 2], [60_000, 1, 1], [60_000, 2, 2], [70_000, 77, 3]],
  pits: [{ t: 130_000, number: 2, lap: 2, laneS: 20, stopS: 2.5 }],
  raceControl: [
    { t: 10_000, category: "Other", flag: null, message: "RACE START" },
    { t: 90_000, category: "SafetyCar", flag: null, message: "VIRTUAL SAFETY CAR DEPLOYED" },
    { t: 95_000, category: "Other", flag: null, message: "CAR 1 TIME 1:40.000 DELETED - TRACK LIMITS" },
    { t: 310_000, category: "Flag", flag: "CHEQUERED", message: "CHEQUERED FLAG" },
  ],
});

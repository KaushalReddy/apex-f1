// Smoke + accessibility-basics crawler. Run after `npm run build`: `npm run verify:routes`.
// Starts `next start`, crawls every internal link from "/", and checks HTML-level basics.
// It is not a browser: it cannot check contrast, layout, focus order or console errors.
import { spawn } from "node:child_process";
import { createRequire } from "node:module";

const PORT = process.env.VERIFY_PORT ?? "3101";
const BASE = `http://127.0.0.1:${PORT}`;
const REQUIRED = [
  "/", "/live", "/drivers", "/drivers/norris", "/teams", "/teams/ferrari", "/cars", "/cars/mclaren",
  "/circuits", "/circuits/monza", "/standings", "/replay", "/strategy", "/telemetry", "/race-engineer",
];
const EXPECT_404 = ["/does-not-exist", "/drivers/not-a-driver", "/teams/nope", "/cars/nope", "/circuits/nope"];

const nextBin = createRequire(import.meta.url).resolve("next/dist/bin/next");
const server = spawn(process.execPath, [nextBin, "start", "-p", PORT], { stdio: ["ignore", "pipe", "pipe"] });
let serverLog = "";
server.stdout.on("data", (d) => (serverLog += d));
server.stderr.on("data", (d) => (serverLog += d));
const stop = () => server.kill();
process.on("exit", stop);

async function waitReady() {
  for (let i = 0; i < 60; i++) {
    try { if ((await fetch(BASE + "/")).ok) return; } catch {}
    await new Promise((r) => setTimeout(r, 500));
  }
  throw new Error("server did not start\n" + serverLog);
}

const strip = (html) => html.replace(/<script[\s\S]*?<\/script>/g, "").replace(/<style[\s\S]*?<\/style>/g, "");
const text = (s) => s.replace(/<[^>]+>/g, " ").replace(/&[a-z#0-9]+;/gi, " ").replace(/\s+/g, " ").trim();

function checkPage(path, raw, is404) {
  const errs = [];
  const html = strip(raw);
  if (!/<html[^>]*\slang="[a-z-]+"/i.test(html)) errs.push("missing html lang");
  if (!/<title>[^<]+<\/title>/.test(raw)) errs.push("missing/empty title");
  if ((html.match(/<h1[\s>]/g) ?? []).length !== 1) errs.push("expected exactly one h1");
  if (!/id="main"/.test(html)) errs.push("missing #main landmark");
  if (!/href="#main"/.test(html)) errs.push("missing skip link");
  const ids = [...html.matchAll(/\sid="([^"]+)"/g)].map((m) => m[1]);
  const dup = ids.filter((x, i) => ids.indexOf(x) !== i);
  if (dup.length) errs.push("duplicate ids: " + [...new Set(dup)].join(","));
  for (const m of html.matchAll(/aria-(?:labelledby|controls)="([^"]+)"/g))
    for (const id of m[1].split(/\s+/)) if (!ids.includes(id)) errs.push(`aria ref to missing id: ${id}`);
  const levels = [...html.matchAll(/<h([1-6])[\s>]/g)].map((m) => +m[1]);
  levels.forEach((l, i) => { if (i && l > levels[i - 1] + 1) errs.push(`heading level skip h${levels[i - 1]}->h${l}`); });
  for (const m of html.matchAll(/<(a|button)\b([^>]*)>([\s\S]*?)<\/\1>/g)) {
    const name = text(m[3]) || /aria-label="[^"]+"/.test(m[2]);
    if (!name) errs.push(`${m[1]} without accessible name`);
  }
  for (const m of html.matchAll(/<img\b[^>]*>/g)) if (!/\salt=/.test(m[0])) errs.push("img without alt");
  const navLabels = [...html.matchAll(/<nav\b[^>]*aria-label="([^"]+)"/g)].map((m) => m[1]);
  if (navLabels.length !== new Set(navLabels).size) errs.push("duplicate nav labels");
  if (/\bundefined\b|\[object Object\]|\bNaN\b/.test(text(html))) errs.push("rendered undefined/NaN/[object Object]");
  if (!is404 && /<meta[^>]*noindex/.test(html)) errs.push("unexpected noindex");
  return errs;
}

const results = [];
let failed = false;
const fail = (msg) => { failed = true; console.log("  FAIL " + msg); };

try {
  await waitReady();
  const seen = new Set();
  const queue = ["/"];
  while (queue.length) {
    const path = queue.shift();
    if (seen.has(path)) continue;
    seen.add(path);
    const res = await fetch(BASE + path);
    const raw = await res.text();
    const errs = res.status === 200 ? checkPage(path, raw, false) : [`status ${res.status}`];
    results.push({ path, status: res.status, errs });
    for (const m of raw.matchAll(/<a\b[^>]*\shref="(\/[^"#?]*)"/g)) {
      const href = m[1];
      if (!href.startsWith("/_next") && href !== "/icon.svg" && !seen.has(href)) queue.push(href);
    }
  }
  for (const r of results) {
    console.log(`${r.errs.length ? "FAIL" : "ok  "} ${r.status} ${r.path}`);
    r.errs.forEach((e) => fail(`${r.path}: ${e}`));
  }
  for (const p of REQUIRED) if (!seen.has(p)) fail(`required route not reachable via links: ${p}`);
  for (const p of EXPECT_404) {
    const res = await fetch(BASE + p);
    const raw = await res.text();
    const errs = res.status === 404 ? checkPage(p, raw, true) : [`expected 404, got ${res.status}`];
    console.log(`${errs.length ? "FAIL" : "ok  "} ${res.status} ${p} (expected 404)`);
    errs.forEach((e) => fail(`${p}: ${e}`));
  }
  console.log(`\n${results.length} pages crawled, ${EXPECT_404.length} 404 checks, ${failed ? "FAILURES" : "all passed"}`);
} catch (e) {
  failed = true;
  console.error(e);
} finally {
  stop();
}
process.exit(failed ? 1 : 0);

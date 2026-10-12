/**
 * SERVER-ONLY: reads circuit geometry artifacts from src/data/circuits/<slug>.geometry.json at build/render time.
 * Import only from server components. The slug is validated, so it cannot escape the data directory.
 */
import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import { parseCircuitGeometry } from "./geometry";
import type { GeometryLoadResult } from "./types";

const DIR = path.join(process.cwd(), "src", "data", "circuits");
const SUFFIX = ".geometry.json";
const SLUG = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

export async function loadCircuitGeometry(slug: string): Promise<GeometryLoadResult> {
  if (!SLUG.test(slug)) return { status: "missing" };
  let text: string;
  try {
    text = await readFile(path.join(DIR, `${slug}${SUFFIX}`), "utf8");
  } catch (e) {
    return (e as NodeJS.ErrnoException).code === "ENOENT" ? { status: "missing" } : { status: "invalid", error: "geometry file could not be read" };
  }
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    return { status: "invalid", error: "geometry file is not valid JSON" };
  }
  const parsed = parseCircuitGeometry(raw);
  return parsed.ok ? { status: "ok", geometry: parsed.geometry } : { status: "invalid", error: parsed.error };
}

/** Slugs that have a geometry file (existence only; validity is checked when a circuit page loads). */
export async function availableGeometrySlugs(): Promise<Set<string>> {
  try {
    return new Set((await readdir(DIR)).filter((f) => f.endsWith(SUFFIX)).map((f) => f.slice(0, -SUFFIX.length)));
  } catch {
    return new Set();
  }
}

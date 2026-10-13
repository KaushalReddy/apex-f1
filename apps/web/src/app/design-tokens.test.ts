import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

// Reads the real stylesheet so the guard cannot drift from what ships.
const css = readFileSync(path.join(process.cwd(), "src", "app", "globals.css"), "utf8");
const token = (name: string): string => {
  const m = css.match(new RegExp(`--color-${name}:\\s*(#[0-9a-fA-F]{6})`));
  if (!m) throw new Error(`token --color-${name} not found`);
  return m[1];
};

// Local WCAG helper: this guard deliberately does not depend on the circuit renderer's modules.
function luminance(hex: string): number {
  const n = parseInt(hex.slice(1), 16);
  const [r, g, b] = [(n >> 16) & 255, (n >> 8) & 255, n & 255].map((c) => {
    const v = c / 255;
    return v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}
function contrastRatio(a: string, b: string): number {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
}

const SURFACES = ["bg", "surface", "surface-2", "surface-3"] as const;

describe("design tokens (WCAG AA for text, 3:1 for interface boundaries)", () => {
  it.each(SURFACES)("primary, secondary and subtle text reach 4.5:1 on %s", (s) => {
    for (const t of ["fg", "muted", "subtle"]) expect(contrastRatio(token(t), token(s)), `${t} on ${s}`).toBeGreaterThanOrEqual(4.5);
  });

  it.each(SURFACES)("red text (accent-strong) and status colours reach 4.5:1 on %s", (s) => {
    for (const t of ["accent-strong", "success", "warning", "danger", "info"]) expect(contrastRatio(token(t), token(s)), `${t} on ${s}`).toBeGreaterThanOrEqual(4.5);
  });

  it("red fills carry dark text (white on red would fail) and the red indicator is visible against the page", () => {
    expect(contrastRatio(token("accent-fg"), token("accent"))).toBeGreaterThanOrEqual(4.5);
    expect(contrastRatio("#ffffff", token("accent"))).toBeLessThan(4.5);
    expect(contrastRatio(token("accent"), token("bg"))).toBeGreaterThanOrEqual(3);
    expect(contrastRatio(token("accent-fg"), token("accent-strong"))).toBeGreaterThanOrEqual(4.5); // primary button hover
  });

  it("keeps the red distinct from the error colour so brand red does not read as an error", () => {
    expect(token("danger").toLowerCase()).not.toBe(token("accent").toLowerCase());
  });

  it("defines the motion system and a reduced-motion override", () => {
    expect(css).toMatch(/--duration-fast:\s*\d+ms/);
    expect(css).toMatch(/--duration-base:\s*\d+ms/);
    expect(css).toMatch(/--ease-apex:\s*cubic-bezier/);
    expect(css).toMatch(/@media \(prefers-reduced-motion: reduce\)/);
  });

  it("restores the pointer cursor on controls that Tailwind's preflight resets", () => {
    expect(css).toMatch(/button:not\(:disabled\)[\s\S]*cursor:\s*pointer/);
  });
});

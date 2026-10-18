import { describe, expect, it } from "vitest";
import { countdown, shortCountdown } from "./NextSession";

describe("countdown", () => {
  it("splits the time left into days, hours, minutes and seconds, and stops at zero", () => {
    expect(countdown(((2 * 24 + 3) * 3600 + 4 * 60 + 5) * 1000 + 999)).toEqual({ d: 2, h: 3, m: 4, s: 5 });
    expect(countdown(-5000)).toEqual({ d: 0, h: 0, m: 0, s: 0 });
  });

  it("formats the compact tab text, with days only when there are some", () => {
    expect(shortCountdown(((5 * 24 + 6) * 3600 + 41 * 60 + 22) * 1000)).toBe("5d 06:41:22");
    expect(shortCountdown(65_000)).toBe("00:01:05");
  });
});

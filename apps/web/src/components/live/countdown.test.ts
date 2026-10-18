import { describe, expect, it } from "vitest";
import { countdown } from "./NextSession";

describe("countdown", () => {
  it("splits the time left into days, hours, minutes and seconds, and stops at zero", () => {
    expect(countdown(((2 * 24 + 3) * 3600 + 4 * 60 + 5) * 1000 + 999)).toEqual({ d: 2, h: 3, m: 4, s: 5 });
    expect(countdown(-5000)).toEqual({ d: 0, h: 0, m: 0, s: 0 });
  });
});

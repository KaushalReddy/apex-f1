import { describe, expect, it } from "vitest";
import { findCircuitById, season2026 } from "./catalog";

describe("season2026 (by date, not the catalog snapshot)", () => {
  const cota = findCircuitById("cota")!; // 2026 weekend starts Fri 23 Oct; the race is Sun 25 Oct
  it("keeps a weekend upcoming through race day and marks it held from the Monday after", () => {
    expect(season2026(cota, "2026-10-20")).toBe("upcoming");
    expect(season2026(cota, "2026-10-25")).toBe("upcoming");
    expect(season2026(cota, "2026-10-26")).toBe("held");
  });
  it("keeps called-off races and circuits off the calendar as the catalog says", () => {
    expect(season2026(findCircuitById("bahrain")!, "2026-12-31")).toBe("not-held");
    const off = [...[findCircuitById("imola"), findCircuitById("portimao")]].find((c) => c && c.calendar === "previous");
    if (off) expect(season2026(off, "2026-12-31")).toBe(off.season2026);
  });
});

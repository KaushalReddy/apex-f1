import { describe, expect, it } from "vitest";
import { parentPath } from "./back-link";

describe("parentPath", () => {
  it("goes one level up, and to home from a section", () => {
    expect(parentPath("/drivers/russell")).toBe("/drivers");
    expect(parentPath("/drivers/compare/")).toBe("/drivers");
    expect(parentPath("/drivers")).toBe("/");
  });
});

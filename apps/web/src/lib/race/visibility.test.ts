import { describe, expect, it } from "vitest";
import { emphasis, isHollow, reconcile } from "./visibility";

const present = new Set(["a", "b", "c", "d"]);

describe("circuit focus", () => {
  it("shows everyone normally with no filter", () => {
    const e = emphasis(null, null, present);
    expect(e).toEqual({ prominent: null, source: "all" });
    expect([...present].some((id) => isHollow(e, id))).toBe(false);
  });
  it("keeps one or several selected drivers prominent and hollows out the rest", () => {
    const one = emphasis(new Set(["b"]), null, present);
    expect([...present].filter((id) => isHollow(one, id))).toEqual(["a", "c", "d"]);
    const three = emphasis(new Set(["a", "b", "c"]), null, present);
    expect([...present].filter((id) => isHollow(three, id))).toEqual(["d"]);
  });
  it("never leaves the circuit empty: an empty or entirely stale selection means everyone", () => {
    expect(emphasis(new Set(), null, present).source).toBe("all");
    expect(emphasis(new Set(["x", "y"]), null, present)).toEqual({ prominent: null, source: "all" });
    expect(reconcile(new Set(["a", "x"]), present)).toEqual(new Set(["a"]));
  });
  it("comparison emphasises exactly A and B without touching the user's selection", () => {
    const mine = new Set(["a", "b", "c"]);
    const cmp = emphasis(mine, ["c", "d"], present);
    expect(cmp.source).toBe("compare");
    expect([...present].filter((id) => !isHollow(cmp, id))).toEqual(["c", "d"]);
    expect(mine).toEqual(new Set(["a", "b", "c"])); // untouched, so exiting restores it
    expect(emphasis(mine, null, present).prominent).toEqual(mine);
    // Changing the pair moves the emphasis at once.
    expect([...present].filter((id) => !isHollow(emphasis(mine, ["a", "b"], present), id))).toEqual(["a", "b"]);
  });
  it("ignores a comparison pair that is not in this session (e.g. after switching session)", () => {
    expect(emphasis(new Set(["a"]), ["x", "b"], present)).toEqual({ prominent: new Set(["a"]), source: "focus" });
  });
});

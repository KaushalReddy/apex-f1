import { describe, expect, it } from "vitest";
import { blocks, inline } from "./format";

describe("engineer answer format", () => {
  it("parses bold and moment links, and leaves HTML as plain text", () => {
    expect(inline("**VER** won; see [lap 33](#t=5025000). <b>x</b>")).toEqual([
      { kind: "bold", text: "VER" },
      { kind: "text", text: " won; see " },
      { kind: "moment", text: "lap 33", t: 5025000 },
      { kind: "text", text: ". <b>x</b>" },
    ]);
    // Only #t= links become links: any other URL stays text.
    expect(inline("[x](https://evil.example)")).toEqual([{ kind: "text", text: "[x](https://evil.example)" }]);
  });
  it("splits paragraphs and lists", () => {
    const b = blocks("Answer first.\n\n- one\n- two\nAfter.\n\n1. a\n2) b");
    expect(b.map((x) => x.kind)).toEqual(["p", "ul", "p", "ol"]);
    expect(b[1].kind === "ul" && b[1].items.length).toBe(2);
    expect(b[3].kind === "ol" && b[3].items.length).toBe(2);
  });
});

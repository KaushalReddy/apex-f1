import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { ComparePicker, type PickDriver } from "./ComparePicker";

// TEST DATA: three made-up entries.
const drivers: PickDriver[] = [
  { id: "car-1", number: 1, code: "AAA", name: "Driver One", team: "Team A", colour: "#112233", position: 1 },
  { id: "car-2", number: 2, code: "BBB", name: "Driver Two", team: "Team B", colour: "#445566", position: 2 },
  { id: "car-3", number: 3, code: "CCC", name: null, team: null, colour: "#778899", position: null },
];
const render = (a: string | null, b: string | null) => renderToStaticMarkup(<ComparePicker drivers={drivers} initialA={a} initialB={b} onStart={() => {}} onCancel={() => {}} />);
/** The list row for a driver (only the driver list, not the slot buttons above it). */
const rowOf = (html: string, code: string) => html.slice(html.indexOf('aria-label="Drivers for slot')).split("<li>").find((li) => li.includes(`>${code}</span>`)) ?? "";

describe("ComparePicker", () => {
  it("preselects the focused driver as A, moves on to B and blocks choosing A again", () => {
    const html = render("car-1", null);
    expect(html).toMatch(/aria-checked="true"[^>]*>.*?>B</); // slot B is the active one
    expect(rowOf(html, "AAA")).toContain(`disabled=""`);
    expect(rowOf(html, "BBB")).not.toContain(`disabled=""`);
    expect(html).toContain("Choose two drivers"); // start is not available with one driver
  });
  it("never starts with the same driver twice, even if asked to", () => {
    const html = render("car-2", "car-2");
    expect(html).toContain("Choose two drivers");
  });
  it("offers the start action once two different drivers are chosen, and labels missing data honestly", () => {
    const html = render("car-1", "car-2");
    expect(html).toContain("Compare AAA and BBB");
    expect(rowOf(html, "CCC")).toContain("Team not published");
  });
});

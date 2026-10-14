import { notFound } from "next/navigation";
import { RaceExperience } from "@/components/race/RaceExperience";
import { CIRCUITS, findCircuitById } from "@/lib/circuit/catalog";
import { loadCircuitGeometry } from "@/lib/circuit/load";

/** Simulated race length: short enough to watch end to end, long enough for pit stops and battles. Not the real race distance. */
const DEMO_LAPS = 12;

const seconds = (lap: string) => {
  const m = /^(\d+):(\d{2}\.\d{3})$/.exec(lap);
  return m ? Number(m[1]) * 60 + Number(m[2]) : null;
};

export const dynamicParams = false;
// Only circuits with a generated layout get a simulated race; the rest have nothing to race on.
export async function generateStaticParams() {
  const ok = await Promise.all(
    CIRCUITS.map(async (c) =>
      (await loadCircuitGeometry(c.id)).status === "ok" ? c.id : null,
    ),
  );
  return ok
    .filter((id): id is string => id !== null)
    .map((circuit) => ({ circuit }));
}

type Props = { params: Promise<{ circuit: string }> };

export async function generateMetadata({ params }: Props) {
  const c = findCircuitById((await params).circuit);
  return { title: c ? `${c.shortName} · Simulated race` : "Simulated race" };
}

/** `/circuits/<id>/race`: the simulated race on a circuit's real layout. Real data (replay, live) is only on `/live`. */
export default async function Page({ params }: Props) {
  const circuit = findCircuitById((await params).circuit);
  const result = circuit ? await loadCircuitGeometry(circuit.id) : null;
  if (!circuit || !result || result.status !== "ok") notFound();
  // Demo pace: 4 % slower than the circuit's published F1 race lap record (a simulation parameter, not a prediction).
  const record = circuit.lapRecord ? seconds(circuit.lapRecord.time) : null;
  return (
    <RaceExperience
      geometry={result.geometry}
      circuit={{ slug: circuit.id, name: circuit.shortName }}
      source={{
        kind: "demo",
        totalLaps: DEMO_LAPS,
        baseLapS: record ? Math.round(record * 1.04 * 10) / 10 : 90,
      }}
      exitHref={`/circuits/${circuit.id}`}
    />
  );
}

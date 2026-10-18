import { PickerForm } from "@/components/telemetry/PickerForm";
import { TelemetryLab } from "@/components/telemetry/TelemetryLab";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";
import { PageContainer } from "@/components/ui/page-container";
import { PageHeader } from "@/components/ui/page-header";
import { circuitByShortName } from "@/lib/circuit/catalog";
import { loadCircuitGeometry } from "@/lib/circuit/load";
import { lapTime } from "@/lib/telemetry/analysis";
import { loadSessionTelemetry, loadTelemetryIndex } from "@/lib/telemetry/load";
import { chooseDrivers, chooseSession, selectionNotes } from "@/lib/telemetry/select";

export const metadata = { title: "Telemetry Lab" };

type Props = { searchParams: Promise<{ session?: string; circuit?: string; a?: string; b?: string }> };

const select = "h-10 w-full rounded-md border border-line-strong bg-surface-2 px-2 text-sm text-fg";

/**
 * `/telemetry?session=<sessionKey>&a=<car number or acronym>&b=…`: two drivers' fastest laps of a session, from the exported OpenF1
 * snapshots (tools/openf1-telemetry). Without `session`: the latest qualifying (else race) session at `?circuit=<catalog id>` and/or
 * containing driver `a`; otherwise the latest qualifying session. Drivers default to the session's two fastest.
 */
export default async function Page({ searchParams }: Props) {
  const q = await searchParams;
  const index = await loadTelemetryIndex();
  const header = (
    <PageHeader
      eyebrow="Analysis"
      title="Telemetry Lab"
      description="Two drivers' fastest laps, trace against trace: speed, throttle, brake, gear and RPM by distance or time, with both cars on the 3D circuit."
      badges={<Badge tone="info">Car data · OpenF1</Badge>}
    />
  );
  if (index.length === 0) {
    return (
      <PageContainer>
        {header}
        <EmptyState title="No telemetry yet" status="Unavailable" headingLevel="h2">
          Lap telemetry appears here once a qualifying session or race has been recorded. Nothing is shown rather than invented.
        </EmptyState>
      </PageContainer>
    );
  }

  const { chosen, candidates } = chooseSession(index, q, (short) => circuitByShortName(short)?.id);
  const loaded = await loadSessionTelemetry(chosen.season, chosen.sessionKey);
  if (!loaded.ok) {
    return (
      <PageContainer>
        {header}
        <EmptyState title="This session's telemetry could not be read" status="Error" statusTone="danger" headingLevel="h2">
          {chosen.eventName} {chosen.sessionName}: {loaded.error}. Try another session.
        </EmptyState>
      </PageContainer>
    );
  }
  const s = loaded.session;
  const laps = s.laps; // fastest first
  const { a, b } = chooseDrivers(laps, q);
  const circuit = s.circuitShortName ? circuitByShortName(s.circuitShortName) : undefined;
  const geometry = circuit ? await loadCircuitGeometry(circuit.id) : null;
  const notes = selectionNotes(q, chosen, candidates, a);
  const events = [...new Map(index.map((e) => [`${e.season}-${e.meetingKey}`, e])).values()];
  const label = (l: (typeof laps)[number]) => `${l.acronym ?? `#${l.driverNumber}`} · ${lapTime(l.lapDuration)}`;

  return (
    <PageContainer>
      {header}
      <PickerForm className="mb-4 grid gap-3 rounded-lg border border-line bg-surface p-4 sm:grid-cols-2 lg:grid-cols-[minmax(0,2fr)_repeat(2,minmax(0,1fr))_auto] lg:items-end">
        <label className="flex flex-col gap-1 text-sm">
          <span className="text-muted">Session</span>
          <select name="session" defaultValue={s.sessionKey} className={select}>
            {events.map((e) => (
              <optgroup key={`${e.season}-${e.meetingKey}`} label={`${e.eventName} ${e.season}`}>
                {index
                  .filter((x) => x.meetingKey === e.meetingKey && x.season === e.season)
                  .map((x) => (
                    <option key={x.sessionKey} value={x.sessionKey}>
                      {x.eventName} · {x.sessionName}
                    </option>
                  ))}
              </optgroup>
            ))}
          </select>
        </label>
        {(["a", "b"] as const).map((k) => (
          <label key={k} className="flex flex-col gap-1 text-sm">
            <span className="text-muted">Driver {k.toUpperCase()}</span>
            <select name={k} defaultValue={(k === "a" ? a : b)?.driverNumber} className={select}>
              {laps.map((l) => (
                <option key={l.driverNumber} value={l.driverNumber}>
                  {label(l)}
                </option>
              ))}
            </select>
          </label>
        ))}
        <Button type="submit" className="sm:col-span-2 lg:col-span-1">
          Compare
        </Button>
      </PickerForm>

      <p className="mb-4 text-sm text-muted">
        <span className="font-medium text-fg">
          {s.eventName} {s.season} · {s.sessionName}
        </span>{" "}
        · {s.date} · {circuit?.name ?? s.circuitShortName ?? "Unknown circuit"}. {s.lapSelection}
        {s.excluded.length > 0 && ` ${s.excluded.length} deleted lap time${s.excluded.length === 1 ? " was" : "s were"} excluded.`}
      </p>
      {notes.map((n) => (
        <p key={n} role="status" className="-mt-2 mb-4 text-sm text-warning">
          {n}
        </p>
      ))}

      {!a || !b ? (
        <EmptyState title="Not enough laps to compare" status="Unavailable" headingLevel="h2">
          This session has {laps.length} driver{laps.length === 1 ? "" : "s"} with a valid timed lap in the data; a comparison needs two.
        </EmptyState>
      ) : (
        <TelemetryLab key={`${s.sessionKey}-${a.driverNumber}-${b.driverNumber}`} a={a} b={b} geometry={geometry?.status === "ok" ? geometry.geometry : null} />
      )}

      <details className="mt-6 text-sm text-muted">
        <summary className="cursor-pointer hover:text-fg">How these traces are made</summary>
        <ul className="mt-3 max-w-prose list-disc space-y-1.5 pl-5 leading-relaxed">
          <li>Source: OpenF1 car data (about 4 samples per second) and position data for each lap, retrieved on {s.source.fetchedOn}. {s.source.note}</li>
          <li>Brake is published as on or off only, not as pressure. 2026 cars have no DRS, so none is shown.</li>
          <li>
            Distance is derived: each sample&apos;s position is projected onto the circuit centerline the 3D track is drawn from, measured from the start/finish line. Both laps use the same reference line, so
            distances are comparable; the lap length is the centerline&apos;s, not each driver&apos;s own path.
          </li>
          <li>
            The gap trace is derived: the time driver B took to reach each distance minus driver A&apos;s, averaged over 35 m to remove the sawtooth that interpolating 4 Hz samples leaves. Values between
            samples are interpolated (gear and brake as steps); gaps over 1.5 s are left empty.
          </li>
          <li>
            Invalid samples are left as gaps, never drawn: throttle or brake outside their range (the feed&apos;s placeholder value 104) and stretches where every channel repeats unchanged for 2.5 s or
            more while the car keeps moving (a frozen feed). Lap times, sectors and positions are unaffected.
          </li>
        </ul>
      </details>
    </PageContainer>
  );
}

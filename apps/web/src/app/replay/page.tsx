"use client";

import { useEffect, useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";
import { PageContainer } from "@/components/ui/page-container";
import { PageHeader } from "@/components/ui/page-header";
import { Panel } from "@/components/ui/panel";
import { fetchReplayTimeline } from "@/lib/replay/api";
import type { PositionFrame } from "@/lib/replay/types";

const SESSION_KEY = 9523;
const FROM = 1716728400000;
const TO = 1716728410000;

export default function Page() {
  const [frames, setFrames] = useState<PositionFrame[]>([]);
  const [frameIndex, setFrameIndex] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    fetchReplayTimeline(SESSION_KEY, FROM, TO)
      .then(setFrames)
      .catch((err: unknown) => {
        setError(err instanceof Error ? err.message : "Failed to load replay");
      })
      .finally(() => setLoading(false));
  }, [attempt]);

  const retry = () => {
    setError(null);
    setFrames([]);
    setFrameIndex(0);
    setLoading(true);
    setAttempt((n) => n + 1);
  };

  const frame = frames[frameIndex];

  return (
    <PageContainer>
      <PageHeader
        eyebrow="Analysis"
        title="Race Replay"
        description="Reconstruct a past session from telemetry stored by the APEX F1 backend. This is the table view; the 3D replay is planned."
        badges={
          <>
            <Badge tone="success">Stored telemetry</Badge>
            <Badge>Monaco 2024 · Race · Session {SESSION_KEY}</Badge>
          </>
        }
      />

      {loading && (
        <Panel>
          <div role="status" aria-live="polite" className="flex items-center gap-3 text-sm text-muted">
            <span aria-hidden="true" className="inline-block size-2 animate-pulse-soft rounded-full bg-info" />
            Loading replay telemetry…
          </div>
        </Panel>
      )}

      {error && (
        <Panel>
          <div role="alert">
            <p className="font-semibold text-danger">Could not load the replay</p>
            <p className="mt-2 text-sm text-muted">{error}</p>
            <p className="mt-2 text-sm text-muted">Make sure the Spring Boot API is running on port 8080.</p>
          </div>
          <div className="mt-4">
            <Button variant="secondary" size="sm" onClick={retry}>
              Try again
            </Button>
          </div>
        </Panel>
      )}

      {!loading && !error && frames.length === 0 && (
        <EmptyState title="No replay frames in this window" status="Empty" headingLevel="h2">
          The backend answered, but returned no frames for session {SESSION_KEY} in the requested time window. Nothing is estimated to fill the gap.
        </EmptyState>
      )}

      {!loading && !error && frame && (
        <div className="space-y-6">
          <Panel>
            <dl className="flex flex-wrap items-start justify-between gap-x-8 gap-y-4">
              <div>
                <dt className="eyebrow">Replay clock (UTC)</dt>
                <dd className="mt-1.5 text-lg tabular-nums">{new Date(frame.t).toISOString()}</dd>
              </div>
              <div>
                <dt className="eyebrow">Cars</dt>
                <dd className="mt-1.5 font-display text-3xl font-semibold leading-none tabular-nums">{frame.cars.length}</dd>
              </div>
              <div>
                <dt className="eyebrow">Frames</dt>
                <dd className="mt-1.5 font-display text-3xl font-semibold leading-none tabular-nums">{frames.length}</dd>
              </div>
            </dl>
          </Panel>

          <Panel>
            <label className="eyebrow block" htmlFor="replay-progress">
              Playback
            </label>

            <input
              id="replay-progress"
              className="mt-3 h-6 w-full"
              type="range"
              min={0}
              max={Math.max(frames.length - 1, 0)}
              value={frameIndex}
              aria-valuetext={`Frame ${frameIndex + 1} of ${frames.length}, ${new Date(frame.t).toISOString()}`}
              onChange={(event) => setFrameIndex(Number(event.target.value))}
            />

            <div className="mt-2 flex justify-between text-xs tabular-nums text-muted">
              <span>Frame {frameIndex + 1}</span>
              <span>{frames.length} total</span>
            </div>
          </Panel>

          <Panel>
            <h2 className="font-display text-2xl font-semibold tracking-[0.01em]">Car positions</h2>
            <p className="mt-1 text-sm text-muted">Coordinates are the provider&apos;s native location units, stored and shown unscaled.</p>

            <div className="mt-4 overflow-x-auto">
              <table className="w-full min-w-[32rem] text-left text-sm">
                <caption className="sr-only">Car positions for frame {frameIndex + 1} of {frames.length}</caption>
                <thead className="border-b border-line-strong text-xs uppercase tracking-[0.08em] text-subtle">
                  <tr>
                    <th scope="col" className="px-3 py-2.5 font-semibold">Driver</th>
                    <th scope="col" className="px-3 py-2.5 text-right font-semibold">X</th>
                    <th scope="col" className="px-3 py-2.5 text-right font-semibold">Y</th>
                    <th scope="col" className="px-3 py-2.5 text-right font-semibold">Z</th>
                    <th scope="col" className="px-3 py-2.5 text-right font-semibold">Sample time (ms)</th>
                  </tr>
                </thead>

                <tbody className="divide-y divide-line">
                  {frame.cars.map((car) => (
                    <tr key={car.driverNumber} className="hover:bg-surface-2">
                      <th scope="row" className="px-3 py-2.5 font-semibold tabular-nums">
                        #{car.driverNumber}
                      </th>
                      <td className="px-3 py-2.5 text-right tabular-nums">{car.x}</td>
                      <td className="px-3 py-2.5 text-right tabular-nums">{car.y}</td>
                      <td className="px-3 py-2.5 text-right tabular-nums">{car.z}</td>
                      <td className="px-3 py-2.5 text-right tabular-nums text-muted">{car.sampleT}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </Panel>
        </div>
      )}
    </PageContainer>
  );
}

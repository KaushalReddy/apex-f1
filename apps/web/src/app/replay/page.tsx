"use client";

import { useEffect, useState } from "react";
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

  useEffect(() => {
    fetchReplayTimeline(SESSION_KEY, FROM, TO)
      .then(setFrames)
      .catch((err: unknown) => {
        setError(err instanceof Error ? err.message : "Failed to load replay");
      })
      .finally(() => setLoading(false));
  }, []);

  const frame = frames[frameIndex];

  return (
    <PageContainer>
      <PageHeader
        eyebrow="Analysis"
        title="Race Replay"
        description="Reconstruct a past session from telemetry stored by the APEX F1 backend."
        badges={
          <span className="rounded-full border border-line px-3 py-1 text-xs text-muted">
            Monaco 2024 · Race · Session {SESSION_KEY}
          </span>
        }
      />

      {loading && (
        <Panel>
          <p className="text-muted">Loading replay telemetry…</p>
        </Panel>
      )}

      {error && (
        <Panel>
          <p className="text-red-400">{error}</p>
          <p className="mt-2 text-sm text-muted">
            Make sure the Spring Boot API is running on port 8080.
          </p>
        </Panel>
      )}

      {!loading && !error && frame && (
        <div className="space-y-6">
          <Panel>
            <div className="flex flex-wrap items-center justify-between gap-4">
              <div>
                <p className="text-sm text-muted">Replay clock</p>
                <p className="mt-1 font-mono text-lg">
                  {new Date(frame.t).toISOString()}
                </p>
              </div>

              <div>
                <p className="text-sm text-muted">Cars</p>
                <p className="mt-1 text-lg font-semibold">{frame.cars.length}</p>
              </div>

              <div>
                <p className="text-sm text-muted">Frames</p>
                <p className="mt-1 text-lg font-semibold">{frames.length}</p>
              </div>
            </div>
          </Panel>

          <Panel>
            <label className="block text-sm text-muted" htmlFor="replay-progress">
              Playback
            </label>

            <input
              id="replay-progress"
              className="mt-3 w-full"
              type="range"
              min={0}
              max={Math.max(frames.length - 1, 0)}
              value={frameIndex}
              onChange={(event) => setFrameIndex(Number(event.target.value))}
            />

            <div className="mt-2 flex justify-between text-xs text-muted">
              <span>Frame {frameIndex + 1}</span>
              <span>{frames.length} total</span>
            </div>
          </Panel>

          <Panel>
            <h2 className="text-lg font-semibold">Car positions</h2>

            <div className="mt-4 overflow-x-auto">
              <table className="w-full text-left text-sm">
                <thead className="border-b border-line text-muted">
                  <tr>
                    <th className="px-3 py-2">Driver</th>
                    <th className="px-3 py-2">X</th>
                    <th className="px-3 py-2">Y</th>
                    <th className="px-3 py-2">Z</th>
                    <th className="px-3 py-2">Sample</th>
                  </tr>
                </thead>

                <tbody>
                  {frame.cars.map((car) => (
                    <tr
                      key={car.driverNumber}
                      className="border-b border-line/50"
                    >
                      <td className="px-3 py-2 font-semibold">
                        #{car.driverNumber}
                      </td>
                      <td className="px-3 py-2 font-mono">{car.x}</td>
                      <td className="px-3 py-2 font-mono">{car.y}</td>
                      <td className="px-3 py-2 font-mono">{car.z}</td>
                      <td className="px-3 py-2 font-mono text-muted">
                        {car.sampleT}
                      </td>
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

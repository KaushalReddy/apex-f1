"use client";

import dynamic from "next/dynamic";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Panel } from "@/components/ui/panel";
import type { CircuitGeometry } from "@/lib/circuit/types";
import type { ViewPreset } from "./CircuitCamera";
import { ErrorBoundary } from "./ErrorBoundary";

// three.js touches window/WebGL, so the scene is client-only. The server renders just this placeholder.
const CircuitScene = dynamic(() => import("./CircuitScene"), {
  ssr: false,
  loading: () => <p className="p-6 text-sm text-muted">Loading 3D scene…</p>,
});

function Unavailable({ error }: { error: Error }) {
  return (
    <Panel className="m-4">
      <p className="font-medium">The 3D view could not start</p>
      <p className="mt-2 text-sm text-muted">This usually means WebGL is unavailable or the geometry could not be rendered. The rest of the page still works.</p>
      <p className="mt-3 font-mono text-xs text-subtle">{error.message}</p>
    </Panel>
  );
}

export function CircuitViewer({ geometry, label }: { geometry: CircuitGeometry; label: string }) {
  const [preset, setPreset] = useState<ViewPreset>({ name: "overview", nonce: 0 });
  const set = (name: ViewPreset["name"]) => setPreset((p) => ({ name, nonce: p.nonce + 1 }));

  return (
    <div>
      <div className="mb-3 flex flex-wrap items-center gap-2">
        <Button size="sm" variant="secondary" onClick={() => set("overview")}>
          Reset view
        </Button>
        <Button size="sm" variant="secondary" onClick={() => set("topDown")}>
          Top-down
        </Button>
        <p className="text-xs text-subtle">Drag to orbit, right-drag or arrow keys to pan, scroll to zoom.</p>
      </div>
      <div
        role="group"
        aria-label={`Interactive 3D map of ${label}`}
        className="h-[65vh] min-h-[380px] overflow-hidden rounded-lg border border-line bg-bg"
      >
        <ErrorBoundary fallback={(e) => <Unavailable error={e} />}>
          <CircuitScene geometry={geometry} preset={preset} />
        </ErrorBoundary>
      </div>
    </div>
  );
}

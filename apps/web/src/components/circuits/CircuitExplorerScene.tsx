"use client";

import { useEffect, useMemo } from "react";
import {
  CanvasTexture,
  ConeGeometry,
  MeshBasicMaterial,
  Quaternion,
  SpriteMaterial,
  SRGBColorSpace,
  Vector3,
} from "three";
import CircuitScene from "@/components/circuit/CircuitScene";
import { useCircuitTransform } from "@/components/circuit/CircuitFrame";
import { RaceFit } from "@/components/race/RaceFit";
import { centerlineToWorld } from "@/lib/circuit/transform";
import type { CircuitGeometry } from "@/lib/circuit/types";
import type { Insets, RaceView } from "@/lib/race/fit";

const ARROWS = 6;
const UP = new Vector3(0, 1, 0);

/**
 * Markers attached to the track in world space, so they stay on their track positions at every camera angle (both are scene objects:
 * a camera-facing sprite and meshes): a start/finish label where the geometry says index 0 is the timing line, and arrows for
 * the direction of travel (the order of the car-position samples). Nothing is placed that the data does not support: there are no
 * corner numbers, because the source has no corner positions.
 */
function TrackMarkers({
  geometry,
  labels,
}: {
  geometry: CircuitGeometry;
  labels: boolean;
}) {
  const transform = useCircuitTransform();
  const centerline = useMemo(
    () => centerlineToWorld(geometry, transform),
    [geometry, transform],
  );
  const n = centerline.length / 3;
  const at = (i: number) =>
    new Vector3(
      centerline[i * 3],
      centerline[i * 3 + 1],
      centerline[i * 3 + 2],
    );
  const { cone, material, arrows, label, labelScale } = useMemo(() => {
    // Sized to the circuit (its largest horizontal extent), so markers read the same on a 3 km and a 7 km track.
    let [x0, x1, z0, z1] = [Infinity, -Infinity, Infinity, -Infinity];
    for (let i = 0; i < n; i++)
      [x0, x1, z0, z1] = [
        Math.min(x0, centerline[i * 3]),
        Math.max(x1, centerline[i * 3]),
        Math.min(z0, centerline[i * 3 + 2]),
        Math.max(z1, centerline[i * 3 + 2]),
      ];
    const size = Math.max(x1 - x0, z1 - z0, 1);
    const len = size * 0.028;
    const cone = new ConeGeometry(len * 0.38, len, 3).translate(0, len / 2, 0);
    const material = new MeshBasicMaterial({
      color: "#f3f5f7",
      transparent: true,
      opacity: 0.85,
      depthWrite: false,
    });
    const arrows = Array.from({ length: ARROWS }, (_, k) => {
      const i = Math.floor(((k + 0.5) / ARROWS) * n);
      const p = new Vector3(
        centerline[i * 3],
        centerline[i * 3 + 1] + 3,
        centerline[i * 3 + 2],
      );
      const j = Math.min(n - 1, i + 3);
      const dir = new Vector3(
        centerline[j * 3] - centerline[i * 3],
        0,
        centerline[j * 3 + 2] - centerline[i * 3 + 2],
      ).normalize();
      return {
        position: p,
        quaternion: new Quaternion().setFromUnitVectors(UP, dir),
      };
    });
    // Start/finish label drawn once into a canvas texture (no font download).
    let label: SpriteMaterial | null = null;
    if (typeof document !== "undefined") {
      const c = Object.assign(document.createElement("canvas"), {
        width: 512,
        height: 128,
      });
      const ctx = c.getContext("2d");
      if (ctx) {
        ctx.fillStyle = "rgba(20,24,30,0.9)";
        ctx.beginPath();
        ctx.roundRect(4, 4, 504, 120, 18);
        ctx.fill();
        ctx.fillStyle = "#f3f5f7";
        ctx.font =
          "600 56px system-ui, -apple-system, 'Segoe UI', Arial, sans-serif";
        ctx.textAlign = "center";
        ctx.textBaseline = "middle";
        ctx.fillText("Start / finish", 256, 68);
        const map = new CanvasTexture(c);
        map.colorSpace = SRGBColorSpace;
        label = new SpriteMaterial({
          map,
          transparent: true,
          depthTest: false,
        });
      }
    }
    return {
      cone,
      material,
      arrows,
      label,
      labelScale: [size * 0.16, size * 0.04, 1] as [number, number, number],
    };
  }, [centerline, n]);
  useEffect(
    () => () => {
      cone.dispose();
      material.dispose();
      label?.map?.dispose();
      label?.dispose();
    },
    [cone, material, label],
  );
  if (!labels) return null;
  const start = at(0);
  return (
    <group name="track-markers">
      {arrows.map((a, k) => (
        <mesh
          key={k}
          geometry={cone}
          material={material}
          position={a.position}
          quaternion={a.quaternion}
          renderOrder={4}
          raycast={() => null}
        />
      ))}
      {geometry.derivation.startFinishAtIndex0 && label && (
        <sprite
          material={label}
          position={[start.x, start.y + labelScale[1] * 1.2, start.z]}
          scale={labelScale}
          center={[0.5, 0]}
          renderOrder={6}
          raycast={() => null}
        />
      )}
    </group>
  );
}

export default function CircuitExplorerScene({
  geometry,
  view,
  fitNonce,
  insets,
  labels,
}: {
  geometry: CircuitGeometry;
  view: RaceView;
  fitNonce: number;
  insets: Insets;
  labels: boolean;
}) {
  return (
    <CircuitScene geometry={geometry} preset={{ name: "overview", nonce: 0 }}>
      <RaceFit
        geometry={geometry}
        nonce={fitNonce}
        insets={insets}
        view={view}
      />
      <TrackMarkers geometry={geometry} labels={labels} />
    </CircuitScene>
  );
}

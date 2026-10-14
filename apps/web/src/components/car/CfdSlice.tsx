"use client";

import { useEffect, useMemo } from "react";
import { CanvasTexture, DoubleSide, MeshBasicMaterial, PlaneGeometry, SRGBColorSpace } from "three";
import { decode, streamlines } from "@/lib/cfd/field";
import { toCar, type CfdResult } from "@/lib/cfd/model";
import { displayRange, paintField, type FieldName } from "./cfdPaint";

/**
 * A COMPUTED 2D flow-field slice shown in the car view: the SU2 solution of the rear-wing section, placed in car space at the section's
 * spanwise station using the case's own transform (solver -> car). Only rear-wing results carry a transform; other results are not
 * drawn on the car.
 */
export function CfdSlice({ result, field }: { result: CfdResult; field: FieldName }) {
  const t = result.transform;
  const built = useMemo(() => {
    if (!t || typeof document === "undefined") return null;
    const f = decode(result.field);
    const canvas = document.createElement("canvas");
    paintField(canvas, f, field, displayRange(field, field === "speed" ? f.speed : f.cp), { flipX: true, lines: streamlines(f, 22), scale: 4 });
    const map = new CanvasTexture(canvas);
    map.colorSpace = SRGBColorSpace;
    const [x0, x1, y0, y1] = f.window;
    const [cxA, cyA] = toCar(t, [x0, y0]);
    const [cxB, cyB] = toCar(t, [x1, y1]);
    return {
      geometry: new PlaneGeometry(Math.abs(cxA - cxB), Math.abs(cyB - cyA)),
      material: new MeshBasicMaterial({ map, transparent: true, opacity: 0.92, side: DoubleSide, depthWrite: false }),
      position: [(cxA + cxB) / 2, (cyA + cyB) / 2, t.z] as [number, number, number],
    };
  }, [result, field, t]);
  useEffect(
    () => () => {
      built?.material.map?.dispose();
      built?.material.dispose();
      built?.geometry.dispose();
    },
    [built],
  );
  if (!built) return null;
  return <mesh name="cfd-slice" geometry={built.geometry} material={built.material} position={built.position} renderOrder={3} raycast={() => null} />;
}

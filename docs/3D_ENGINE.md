# APEX F1: 3D engine design

Not implemented. Three.js / React Three Fiber / drei are **not** installed yet (ADR-009); they
arrive in Phase 3. This document fixes the contracts so Phase 3 is not improvised.

## 1. Coordinate pipeline

```
provider coords (x, y, z in provider units)
  1. scale   : multiply by unitMeters (from circuit_geometry, spike-verified)  -> metres
  2. recentre: subtract centerline centroid (cx, cy, cz)  -> keeps floats small
  3. axes    : three.x = x', three.z = -y', three.y = z' * elevationScale
  4. rotate  : optional yaw about Y for camera framing (default 0)
  -> Three.js world (metres, Y up, right-handed)
```
- Step 3 flips Y to -Z so a map-style top view (x right, y up) looks the same in Three.js.
  Whether the provider frame is right- or left-handed **[VERIFY]**: if the rendered circuit is
  mirrored, fix it here, once, with a single sign.
- `elevationScale` defaults to 1. Any exaggeration is a visible, labelled option, never baked in.
- One pure TS module (`src/domain/coords.ts`) owns this. Components never apply their own offsets.
- A unit test round-trips known points (synthetic) and checks the centerline length is preserved.

## 2. Track
- Input: `CircuitGeometry.points` (closed loop, evenly spaced, already smoothed).
- Mesh: extrude a ribbon along the centerline. Width comes from sourced data; if `widthMeters` is
  null, use a clearly named default constant and show it in the debug overlay (no silent invention).
- Kerbs, pit lane, grandstands: later, only from sourced geometry or obviously generic props.

## 3. Cars
- State per car: previous sample, next sample, render time. Render time lags real time by a
  configurable buffer (start at 500 ms) so there are always two samples to interpolate between.
- Position: linear interpolation by `sampleT`. Heading: from the interpolated velocity, smoothed
  (slerp) and held when speed is near zero. Stale cars freeze and are visibly marked.
- Never extrapolate beyond the last sample for more than the buffer; show `stale` instead.
- Components planned: `Car3D` (geometry/materials), `CarMarker` (number/abbr), `DriverCar`
  (wires state to a car), `CarCamera` (follow/orbit). Domain logic stays in `src/domain/`.

## 4. Track progress
Needed for sector/gap displays and for stitching 2D charts to the 3D scene. Project each car to
the centerline with a **windowed** search around its previous index (the spike's whole-line
nearest-vertex search is ambiguous on crossovers such as Suzuka). Output: lap-distance in metres.

## 5. Performance guardrails (measure before optimizing)
- Instanced meshes for 20 cars if draw calls matter; shared materials per team.
- Update car transforms in `useFrame` via refs; no React state per frame.
- Keep the scene static except cars; bake track mesh once.
- WebGL fallback and error boundary in Phase 16.

import { frameCircuit, type CameraPreset } from "@/lib/circuit/camera";

/**
 * Race-view framing. Reuses the Phase 3 solver (`frameCircuit`: for each centerline vertex, the distance at which it fits the frustum for
 * the real aspect and lens, maximum over vertices) with extra room for what the race view adds around the road: markers (a few metres
 * beyond the road edge) and their labels (drawn to the side of each marker), hence the wider padding.
 */
export const RACE_FIT_PADDING = 0.14;
export const MARKER_MARGIN_M = 25;

export function raceFraming(centerline: Float32Array, aspect: number, drawnWidthMeters: number): CameraPreset {
  return frameCircuit(centerline, aspect, { marginMeters: drawnWidthMeters / 2 + MARKER_MARGIN_M, padding: RACE_FIT_PADDING }).overview;
}

export interface Insets {
  top: number;
  right: number;
  bottom: number;
  left: number;
}

/**
 * Fits the circuit into the part of the canvas that floating panels leave free (CSS pixel insets), keeping the full canvas as the
 * render target. The circuit is fitted for the safe rectangle's aspect, moved back so that rectangle's height spans the fit (the camera's
 * vertical lens is fixed), then camera and target are shifted together so the circuit centres in the safe rectangle instead of the canvas.
 */
export function fitInSafeArea(centerline: Float32Array, size: { width: number; height: number }, insets: Insets, drawnWidthMeters: number) {
  const safeW = Math.max(120, size.width - insets.left - insets.right);
  const safeH = Math.max(120, size.height - insets.top - insets.bottom);
  const base = raceFraming(centerline, safeW / safeH, drawnWidthMeters);
  const distance = base.distance * (size.height / safeH);
  const dir = [0, 1, 2].map((k) => (base.position[k] - base.target[k]) / base.distance);
  // Camera basis for a Y-up lookAt: forward f = -dir, right = f x up, up' = right x f.
  const f = [-dir[0], -dir[1], -dir[2]];
  const rl = Math.hypot(f[2], f[0]) || 1;
  const right = [-f[2] / rl, 0, f[0] / rl];
  const up = [right[1] * f[2] - right[2] * f[1], right[2] * f[0] - right[0] * f[2], right[0] * f[1] - right[1] * f[0]];
  const worldPerPx = (2 * distance * Math.tan((base.fov * Math.PI) / 360)) / size.height;
  const ox = (insets.left - insets.right) / 2; // safe centre is right of the canvas centre by ox px
  const oy = (insets.top - insets.bottom) / 2; // and below it by oy px
  const shift = [0, 1, 2].map((k) => -ox * worldPerPx * right[k] + oy * worldPerPx * up[k]);
  const target: [number, number, number] = [base.target[0] + shift[0], base.target[1] + shift[1], base.target[2] + shift[2]];
  const position: [number, number, number] = [0, 1, 2].map((k) => target[k] + dir[k] * distance) as [number, number, number];
  return { position, target, fov: base.fov, distance };
}

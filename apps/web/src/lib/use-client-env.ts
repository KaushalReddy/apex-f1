"use client";

import { useSyncExternalStore } from "react";

/** Client-environment hooks shared by the 3D views (car viewer, race view). */

const subscribeReducedMotion = (cb: () => void) => {
  const mq = window.matchMedia("(prefers-reduced-motion: reduce)");
  mq.addEventListener("change", cb);
  return () => mq.removeEventListener("change", cb);
};
export const useReducedMotion = () =>
  useSyncExternalStore(subscribeReducedMotion, () => window.matchMedia("(prefers-reduced-motion: reduce)").matches, () => false);

let webglSupport: boolean | undefined;
function detectWebGL(): boolean {
  if (webglSupport === undefined) {
    try {
      const c = document.createElement("canvas");
      webglSupport = !!(c.getContext("webgl2") ?? c.getContext("webgl"));
    } catch {
      webglSupport = false;
    }
  }
  return webglSupport;
}
const noSubscribe = () => () => {};
/** null while server-rendering / before hydration; then whether a WebGL context can be created. */
export const useWebGL = () => useSyncExternalStore(noSubscribe, detectWebGL, () => null);


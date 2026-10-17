"use client";

import { useEffect, useState, useSyncExternalStore, type RefObject } from "react";

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


/**
 * True once `ref` has come within `margin` of the viewport (and stays true): lets a below-the-fold 3D view skip loading the 3D engine and
 * building its scene until the user scrolls near it. True straight away where IntersectionObserver is missing.
 */
export function useNearViewport(ref: RefObject<Element | null>, margin = "300px"): boolean {
  const [near, setNear] = useState(false);
  useEffect(() => {
    const el = ref.current;
    if (near || !el) return;
    if (typeof IntersectionObserver === "undefined") {
      queueMicrotask(() => setNear(true));
      return;
    }
    const io = new IntersectionObserver((entries) => {
      if (entries.some((e) => e.isIntersecting)) {
        setNear(true);
        io.disconnect();
      }
    }, { rootMargin: margin });
    io.observe(el);
    return () => io.disconnect();
  }, [ref, margin, near]);
  return near;
}

"use client";

import { useEffect, useRef, useState, type RefObject } from "react";
import { useRouter } from "next/navigation";
import { cameFromSite } from "@/components/layout/back-link";

/**
 * Shared behaviour of the full-window views (Live race, Car Lab, Circuit explorer): the page behind the fixed layer does not scroll,
 * browser fullscreen is an optional extra on `theater` (browsers only allow it after a click, so it never changes the layout), and
 * `leave()` returns to the previous page on this site or to `fallbackHref`. `onFullscreenChange` lets the view re-frame its scene.
 */
export function useImmersive(theater: RefObject<HTMLElement | null>, fallbackHref: string, onFullscreenChange?: () => void) {
  const router = useRouter();
  const [nativeFs, setNativeFs] = useState(false);
  const [fsSupported, setFsSupported] = useState(false);
  const onChange = useRef(onFullscreenChange);
  useEffect(() => {
    onChange.current = onFullscreenChange;
  });

  useEffect(() => {
    const overflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    void Promise.resolve().then(() => setFsSupported(!!document.documentElement.requestFullscreen && document.fullscreenEnabled !== false));
    const onFs = () => {
      setNativeFs(!!theater.current && document.fullscreenElement === theater.current);
      onChange.current?.();
    };
    document.addEventListener("fullscreenchange", onFs);
    return () => {
      document.body.style.overflow = overflow;
      document.removeEventListener("fullscreenchange", onFs);
    };
  }, [theater]);

  const toggleBrowserFullscreen = async (on: boolean) => {
    try {
      if (on && theater.current?.requestFullscreen && !document.fullscreenElement) await theater.current.requestFullscreen({ navigationUI: "hide" });
      if (!on && document.fullscreenElement) await document.exitFullscreen();
    } catch {
      // refused (permissions, iframe, user agent): the full-window layer stays as it is
    }
  };
  const leave = () => {
    void toggleBrowserFullscreen(false);
    if (cameFromSite()) router.back();
    else router.push(fallbackHref);
  };
  return { nativeFs, fsSupported, toggleBrowserFullscreen, leave };
}

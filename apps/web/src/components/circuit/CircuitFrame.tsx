"use client";

import { createContext, useContext } from "react";
import type { WorldTransform } from "@/lib/circuit/transform";

/**
 * The circuit's coordinate frame, shared with anything rendered inside the scene.
 * Phase 4 car layers call useCircuitTransform() so cars and track can never disagree about placement.
 */
const CircuitFrameContext = createContext<WorldTransform | null>(null);

export const CircuitFrameProvider = CircuitFrameContext.Provider;

export function useCircuitTransform(): WorldTransform {
  const t = useContext(CircuitFrameContext);
  if (!t) throw new Error("useCircuitTransform must be used inside <CircuitScene>");
  return t;
}

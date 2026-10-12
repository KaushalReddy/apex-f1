"use client";

import { Component, type ErrorInfo, type ReactNode } from "react";

/** Keeps a failed 3D scene (invalid data, no WebGL, GPU context error) from taking the page down. */
export class ErrorBoundary extends Component<{ fallback: (error: Error) => ReactNode; children: ReactNode }, { error: Error | null }> {
  state: { error: Error | null } = { error: null };

  static getDerivedStateFromError(error: Error) {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error("Circuit scene failed:", error.message, info.componentStack);
  }

  render() {
    return this.state.error ? this.props.fallback(this.state.error) : this.props.children;
  }
}

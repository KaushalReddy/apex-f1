"use client";

import { useEffect, useState } from "react";
import { StatusDot } from "@/components/ui/status-dot";
import { cn } from "@/lib/cn";
import type { DataStatus } from "@/lib/data/status";
import { ago } from "@/lib/openf1/time";

const FAILURE: Record<string, string> = {
  "rate-limit": "OpenF1 is rate limiting the sync",
  unavailable: "OpenF1 could not be reached",
  auth: "OpenF1 refused the request",
  request: "OpenF1 rejected a request",
  "invalid-output": "a downloaded race failed validation",
};

/**
 * Where the race data comes from and how current it is (/api/data-status): the snapshot bundled with the build, or OpenF1 data synced
 * after it, with when APEX F1 last retrieved it. Stale or failing syncs say so; nothing here claims the data is live.
 */
export function DataFreshness({ className }: { className?: string }) {
  const [s, setS] = useState<DataStatus | null>(null);
  const [failed, setFailed] = useState(false);
  const [now, setNow] = useState(0);
  useEffect(() => {
    const ctrl = new AbortController();
    fetch("/api/data-status", { signal: ctrl.signal })
      .then((r) => (r.ok ? (r.json() as Promise<DataStatus>) : Promise.reject(new Error(String(r.status)))))
      .then((d) => {
        setS(d);
        setNow(Date.now());
      })
      .catch(() => !ctrl.signal.aborted && setFailed(true));
    const t = setInterval(() => setNow(Date.now()), 60_000);
    return () => {
      ctrl.abort();
      clearInterval(t);
    };
  }, []);

  const line = (tone: "neutral" | "success" | "warning" | "danger" | "info", text: string, title?: string) => (
    <p role="status" className={cn("flex items-center gap-2 text-sm text-muted", className)} title={title}>
      <StatusDot tone={tone} />
      <span>{text}</span>
    </p>
  );
  if (failed) return line("neutral", "Data status unavailable.");
  if (!s) return line("neutral", "Checking data status…");
  const last = ago(s.lastSuccessfulSync, now);
  const abs = s.lastSuccessfulSync ? `Last successful sync: ${new Date(s.lastSuccessfulSync).toLocaleString()}` : undefined;
  if (s.health === "bundled") return line("info", "Race data: the OpenF1 snapshot built into this version of the site.");
  if (s.health === "fresh") return line("success", `Race data synced from OpenF1 ${last}.`, abs);
  if (s.health === "stale") return line("warning", last ? `Race data last synced from OpenF1 ${last}: newer races may be missing.` : "Race data has not been synced from OpenF1 yet: showing the built-in snapshot.", abs);
  return line("warning", `Sync failing (${FAILURE[s.failure ?? ""] ?? "unknown error"})${last ? `: showing data synced ${last}` : ""}.`, abs);
}

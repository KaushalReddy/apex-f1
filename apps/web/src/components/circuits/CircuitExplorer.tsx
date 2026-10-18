"use client";

import dynamic from "next/dynamic";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState, type ReactNode } from "react";
import { ErrorBoundary } from "@/components/circuit/ErrorBoundary";
import { ImmersiveNav } from "@/components/layout/ImmersiveNav";
import { Badge } from "@/components/ui/badge";
import { Button, ButtonLink } from "@/components/ui/button";
import {
  DIRECTION_LABEL,
  SEASON_LABEL,
  TYPE_LABEL,
  type CircuitEntry,
} from "@/lib/circuit/catalog";
import type { CircuitEvent } from "@/lib/circuit/history";
import type { CircuitGeometry } from "@/lib/circuit/types";
import { cn } from "@/lib/cn";
import type { Insets, RaceView } from "@/lib/race/fit";
import { useWebGL } from "@/lib/use-client-env";
import { useImmersive } from "@/lib/use-immersive";

const Scene = dynamic(() => import("./CircuitExplorerScene"), {
  ssr: false,
  loading: () => <Message>Loading the 3D circuit…</Message>,
});

// Padded by the scene's safe-area insets, so the text never sits under the info panel or the switcher.
function Message({
  children,
  insets,
}: {
  children: ReactNode;
  insets?: Insets;
}) {
  return (
    <p
      className="flex h-full items-center justify-center text-center text-sm text-muted"
      style={{ padding: insets ? `${insets.top}px ${insets.right}px ${insets.bottom}px ${insets.left}px` : 24 }}
    >
      {children}
    </p>
  );
}

const GLASS =
  "rounded-lg border border-white/10 bg-surface/70 shadow-2 backdrop-blur-xl [box-shadow:inset_0_1px_0_rgb(255_255_255/0.06),var(--shadow-2)] supports-[not(backdrop-filter:blur(1px))]:bg-surface/95";

export interface Provenance {
  sessionKeys: readonly number[];
  lapsUsed: number;
  points: number;
  measuredLengthM: number;
  scaleLabel: string;
  calibrated: boolean;
  widthLabel: string;
  verdict: string | null;
}

interface Props {
  circuit: CircuitEntry;
  geometry: CircuitGeometry | null;
  provenance: Provenance | null;
  events: CircuitEvent[];
  /** Every circuit, for the switcher (id and short name, catalog order). */
  all: ReadonlyArray<{ id: string; shortName: string; hasLayout: boolean }>;
  /** Telemetry Lab for this circuit's latest exported session, when there is one. */
  telemetryHref?: string | null;
}

function Fact({ k, v, hint }: { k: string; v: ReactNode; hint?: ReactNode }) {
  return (
    <div className="bg-surface/60 px-3 py-2">
      <dt className="text-[11px] uppercase tracking-wider text-subtle">{k}</dt>
      <dd className="mt-0.5 font-medium tabular-nums">{v}</dd>
      {hint && <p className="text-[11px] text-subtle">{hint}</p>}
    </div>
  );
}

/**
 * Circuit explorer: full-window like the race view and the Car Lab. The 3D layout fills the screen; information sits in one glass panel
 * (a bottom sheet on phones), camera controls top right, and the circuit switcher at the bottom.
 */
export function CircuitExplorer({
  circuit,
  geometry,
  provenance,
  events,
  all,
  telemetryHref,
}: Props) {
  const theater = useRef<HTMLDivElement | null>(null);
  const router = useRouter();
  const webgl = useWebGL();
  const [view, setView] = useState<RaceView>("overview");
  const [fitNonce, setFitNonce] = useState(0);
  const [labels, setLabels] = useState(true);
  const [info, setInfo] = useState(true);
  const [phone, setPhone] = useState(false);
  const { nativeFs, fsSupported, toggleBrowserFullscreen, leave } =
    useImmersive(theater, "/circuits", () => setFitNonce((n) => n + 1));

  useEffect(() => {
    const onResize = () => setPhone(window.innerWidth < 768);
    onResize();
    // Phones start with the track unobstructed; the information is one tap away.
    void Promise.resolve().then(() => {
      if (window.innerWidth < 768) setInfo(false);
    });
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, []);

  const i = all.findIndex((c) => c.id === circuit.id);
  const prev = all[(i - 1 + all.length) % all.length];
  const next = all[(i + 1) % all.length];
  const go = (v: RaceView) => {
    setView(v);
    setFitNonce((n) => n + 1);
  };
  // Space the panels take, so the track is framed in the clear area; symmetric on desktop so it stays centred on screen.
  const insets = phone
    ? { top: 112, right: 12, bottom: info ? 420 : 132, left: 12 }
    : { top: 120, right: info ? 400 : 32, bottom: 96, left: info ? 400 : 32 };
  const winners = events.filter((e) => e.winner);

  const panel = (
    <div className="space-y-4 p-4 text-sm">
      <div>
        <p className="eyebrow">
          {circuit.locality} · {circuit.country}
        </p>
        <h1 className="mt-1 font-display text-3xl font-semibold leading-none">
          {circuit.shortName}
        </h1>
        <p className="mt-1 text-xs text-muted">{circuit.name}</p>
        <div className="mt-2 flex flex-wrap gap-1.5">
          {circuit.calendar === "previous" ? (
            <Badge tone="neutral">Not on the 2026 calendar</Badge>
          ) : (
            circuit.season2026 && (
              <Badge
                tone={circuit.season2026 === "not-held" ? "warning" : "info"}
              >
                {SEASON_LABEL[circuit.season2026]}
              </Badge>
            )
          )}
          {geometry ? (
            <Badge tone="info">Layout from car positions</Badge>
          ) : (
            <Badge tone="warning">No layout data</Badge>
          )}
        </div>
      </div>
      <dl
        className="grid grid-cols-2 overflow-hidden rounded-md border border-white/10"
        style={{ gap: 1 }}
      >
        <Fact
          k="Length"
          v={
            circuit.lengthKm != null
              ? `${circuit.lengthKm.toFixed(3)} km`
              : "Not sourced"
          }
        />
        <Fact k="Turns" v={circuit.turns ?? "Not sourced"} />
        <Fact
          k="Type"
          v={circuit.type ? TYPE_LABEL[circuit.type] : "Not sourced"}
        />
        <Fact
          k="Direction"
          v={
            circuit.direction
              ? DIRECTION_LABEL[circuit.direction]
              : "Not sourced"
          }
        />
      </dl>
      <div>
        <p className="eyebrow">F1 race lap record</p>
        {circuit.lapRecord ? (
          <p className="mt-1">
            <span className="font-display text-xl font-semibold tabular-nums">
              {circuit.lapRecord.time}
            </span>{" "}
            <span className="text-muted">
              {circuit.lapRecord.driver ?? "—"}
              {circuit.lapRecord.year ? `, ${circuit.lapRecord.year}` : ""}
              {circuit.lapRecord.car ? ` (${circuit.lapRecord.car})` : ""}
            </span>
            <span className="block text-[11px] text-subtle">
              Race laps on the {circuit.lapRecord.layoutLengthKm.toFixed(3)} km
              layout; qualifying laps do not count.
            </span>
          </p>
        ) : (
          <p className="mt-1 text-muted">Not sourced.</p>
        )}
      </div>
      <div>
        <p className="eyebrow">Grands Prix here in the results data</p>
        {winners.length ? (
          <ul className="mt-1.5 divide-y divide-white/10">
            {winners.map((e) => (
              <li
                key={`${e.season}-${e.round}`}
                className="flex flex-wrap items-baseline justify-between gap-x-3 py-1.5"
              >
                <span className="tabular-nums text-muted">{e.season}</span>
                <span className="text-right">
                  Won by{" "}
                  {e.winner!.slug ? (
                    <Link
                      href={`/drivers/${e.winner!.slug}`}
                      className="font-medium underline decoration-white/30 underline-offset-4 hover:decoration-white"
                    >
                      {e.winner!.name}
                    </Link>
                  ) : (
                    e.winner!.name
                  )}
                  {e.qualifyingP1 && (
                    <span className="block text-[11px] text-subtle">
                      Fastest in qualifying: {e.qualifyingP1.name}
                    </span>
                  )}
                </span>
              </li>
            ))}
          </ul>
        ) : (
          <p className="mt-1 text-muted">
            No race at this circuit in the exported seasons (2024–2026 so far).
          </p>
        )}
        {telemetryHref && (
          <Link
            href={telemetryHref}
            className="mt-2 inline-block text-sm font-medium underline decoration-white/30 underline-offset-4 hover:decoration-white"
          >
            Compare lap telemetry here
          </Link>
        )}
      </div>
      <details className="text-xs text-muted">
        <summary className="cursor-pointer hover:text-fg">
          Where the layout and facts come from
        </summary>
        <ul className="mt-2 list-disc space-y-1 pl-4 leading-relaxed">
          {provenance ? (
            <>
              <li>
                Layout: averaged racing line from OpenF1 car positions (session{" "}
                {provenance.sessionKeys.join(", ")}, {provenance.lapsUsed} clean
                laps, {provenance.points} points). A reconstruction, not a
                surveyed circuit model.
              </li>
              <li>
                Measured length about{" "}
                {provenance.measuredLengthM.toLocaleString("en-GB")} m; scale:{" "}
                {provenance.scaleLabel}. {provenance.widthLabel}.
              </li>
              <li>
                Not modelled: kerbs, pit lane, run-off, walls and scenery.
                Elevation is the median of car heights and is not validated.
              </li>
              {provenance.verdict && (
                <li>Reconstruction check: {provenance.verdict}.</li>
              )}
            </>
          ) : (
            <li>
              No layout has been generated for this circuit, so none is drawn.
            </li>
          )}
          <li>
            Length, turns, type and direction: Wikipedia&apos;s list of Formula
            One circuits (last configuration used in F1). Lap record:{" "}
            <a
              href={circuit.wikipedia}
              className="underline underline-offset-4 hover:text-fg"
            >
              the circuit&apos;s Wikipedia article
            </a>
            . Grands Prix: OpenF1 (circuit key {circuit.openf1.circuitKey}).
          </li>
        </ul>
      </details>
    </div>
  );

  return (
    <div ref={theater} className="fixed inset-0 z-[70] bg-bg">
      <section
        aria-label={`3D layout of ${circuit.shortName}`}
        className="absolute inset-0 overflow-hidden bg-bg"
      >
        {!geometry ? (
          <Message insets={insets}>
            No layout has been generated for {circuit.shortName}, so there is no
            3D view. Nothing is drawn rather than guessing a layout.
          </Message>
        ) : webgl === null ? (
          <Message insets={insets}>Loading the 3D circuit…</Message>
        ) : !webgl ? (
          <Message insets={insets}>
            WebGL is not available in this browser, so the 3D layout cannot be
            drawn. The circuit information still works.
          </Message>
        ) : (
          <ErrorBoundary
            fallback={(e) => (
              <Message insets={insets}>
                The 3D view could not start ({e.message}).
              </Message>
            )}
          >
            <Scene
              geometry={geometry}
              view={view}
              fitNonce={fitNonce}
              insets={insets}
              labels={labels}
            />
          </ErrorBoundary>
        )}
      </section>

      <ImmersiveNav
        onBack={leave}
        actions={
          <>
            {fsSupported && (
              <span className="hidden sm:contents">
                <Button
                  size="sm"
                  variant="ghost"
                  aria-pressed={nativeFs}
                  className="h-8 px-2.5"
                  onClick={() => void toggleBrowserFullscreen(!nativeFs)}
                >
                  {nativeFs ? "Exit browser fullscreen" : "Browser fullscreen"}
                </Button>
              </span>
            )}
            <Button
              size="sm"
              variant="secondary"
              className="h-8 px-2.5"
              onClick={leave}
              title="Leave the circuit explorer"
            >
              Exit
            </Button>
          </>
        }
      />

      <div className="pointer-events-none absolute inset-x-2 top-14 z-20 flex justify-end sm:inset-x-4 sm:top-16">
        <div
          className={cn(
            "pointer-events-auto flex flex-wrap justify-end gap-0.5 p-1 max-sm:[&>button]:px-2",
            GLASS,
          )}
        >
          {(
            [
              ["overview", "Overview"],
              ["topDown", "Top-down"],
            ] as Array<[RaceView, string]>
          ).map(([v, label]) => (
            <Button
              key={v}
              size="sm"
              variant="ghost"
              aria-pressed={view === v}
              className={cn("h-8 px-2.5", view === v && "text-fg")}
              onClick={() => go(v)}
              disabled={!geometry}
            >
              {label}
            </Button>
          ))}
          <Button
            size="sm"
            variant="ghost"
            className="h-8 px-2.5"
            onClick={() => setFitNonce((n) => n + 1)}
            disabled={!geometry}
            title="Frame the whole circuit"
          >
            Fit
          </Button>
          <Button
            size="sm"
            variant="ghost"
            aria-pressed={labels}
            className={cn("h-8 px-2.5", !labels && "text-subtle")}
            onClick={() => setLabels((l) => !l)}
            disabled={!geometry}
          >
            Markers
          </Button>
          <Button
            size="sm"
            variant="ghost"
            aria-pressed={info}
            aria-controls="circuit-info"
            className="h-8 px-2.5"
            onClick={() => setInfo((x) => !x)}
          >
            Info
          </Button>
        </div>
      </div>

      {info && (
        <div
          id="circuit-info"
          className={cn(
            "absolute z-10 overflow-y-auto",
            GLASS,
            phone
              ? "inset-x-2 bottom-[4.5rem] max-h-[52svh]"
              : "left-4 top-[6.5rem] max-h-[calc(100%-12.5rem)] w-[23rem]",
          )}
        >
          {panel}
        </div>
      )}
      {!info && <h1 className="sr-only">{circuit.shortName}</h1>}

      <div className="pointer-events-none absolute inset-x-2 bottom-2 z-20 flex justify-center sm:inset-x-4 sm:bottom-4">
        <nav
          aria-label="Circuits"
          className={cn(
            "pointer-events-auto flex max-w-full items-center gap-1 p-1",
            GLASS,
          )}
        >
          <ButtonLink
            href={`/circuits/${prev.id}`}
            size="sm"
            variant="ghost"
            className="h-8 px-2.5"
            aria-label={`Previous circuit: ${prev.shortName}`}
          >
            ←<span className="hidden sm:inline"> {prev.shortName}</span>
          </ButtonLink>
          <label className="flex items-center">
            <span className="sr-only">Circuit</span>
            <select
              value={circuit.id}
              onChange={(e) => router.push(`/circuits/${e.target.value}`)}
              className="h-8 max-w-[11rem] rounded-md border border-white/10 bg-surface-2 px-2 text-sm text-fg"
            >
              {all.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.shortName}
                  {c.hasLayout ? "" : " (no layout)"}
                </option>
              ))}
            </select>
          </label>
          <ButtonLink
            href={`/circuits/${next.id}`}
            size="sm"
            variant="ghost"
            className="h-8 px-2.5"
            aria-label={`Next circuit: ${next.shortName}`}
          >
            <span className="hidden sm:inline">{next.shortName} </span>→
          </ButtonLink>
          {geometry && (
            <ButtonLink
              href={`/circuits/${circuit.id}/race`}
              size="sm"
              variant="secondary"
              className="ml-1 h-8 shrink-0 whitespace-nowrap px-2.5"
              title="Open the simulated race on this circuit"
            >
              <span className="sm:hidden">Race here</span>
              <span className="max-sm:hidden">Simulated race here</span>
            </ButtonLink>
          )}
        </nav>
      </div>
    </div>
  );
}

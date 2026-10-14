"use client";

import dynamic from "next/dynamic";
import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import type { ViewPreset } from "@/components/circuit/CircuitCamera";
import { ErrorBoundary } from "@/components/circuit/ErrorBoundary";
import Link from "next/link";
import { ImmersiveNav } from "@/components/layout/ImmersiveNav";
import { Badge } from "@/components/ui/badge";
import { Button, ButtonLink } from "@/components/ui/button";
import { StatusDot } from "@/components/ui/status-dot";
import { findTeam } from "@/domain/demo";
import { centerlineToWorld, createWorldTransform } from "@/lib/circuit/transform";
import type { CircuitGeometry } from "@/lib/circuit/types";
import { cn } from "@/lib/cn";
import { createDemoRace, paceProfile } from "@/lib/race/demo";
import { demoEntries, teamColor } from "@/lib/race/entries";
import { appendEvents, type RaceEvent } from "@/lib/race/events";
import { DemoProvider, PLAYBACK_SPEEDS, ReplayProvider, realScheduler, type ProviderUpdate, type RaceProvider } from "@/lib/race/providers";
import { MODE_LABEL, SnapshotBuffer, battles, formatGap, formatLapTime, freshness, sortByRaceOrder, toggleSelection } from "@/lib/race/session";
import type { RaceView } from "@/lib/race/fit";
import { createTrackPath } from "@/lib/race/track";
import { fetchReplayTimeline } from "@/lib/replay/api";
import { useReducedMotion, useWebGL } from "@/lib/use-client-env";
import { useImmersive } from "@/lib/use-immersive";
import { Leaderboard } from "./Leaderboard";

const RaceScene = dynamic(() => import("./RaceScene"), {
  ssr: false,
  loading: () => <StageMessage>Loading the 3D circuit…</StageMessage>,
});

function StageMessage({ children }: { children: ReactNode }) {
  return <p className="flex h-full items-center justify-center p-6 text-sm text-muted">{children}</p>;
}

function Unavailable({ reason }: { reason: string }) {
  return (
    <div role="alert" className="flex h-full items-center justify-center p-6 text-center">
      <div className="max-w-md">
        <p className="font-medium">The 3D circuit could not start</p>
        <p className="mt-2 text-sm text-muted">WebGL is unavailable or failed. The race order, driver details and events below still update.</p>
        <p className="mt-3 font-mono text-xs text-subtle">{reason}</p>
      </div>
    </div>
  );
}

export interface RaceExperienceProps {
  geometry: CircuitGeometry;
  circuit: { slug: string; name: string };
  /**
   * Fixed per page, never switched in the view: `/live` shows only real data (a stored replay, or live once connected); the simulated race
   * lives under the circuit explorer (`/circuits/[circuit]/race`), so simulated and real data are never mixed on one page.
   */
  source:
    | { kind: "demo"; totalLaps: number; /** Simulated base lap time (s), chosen per circuit by the page. */ baseLapS: number }
    | { kind: "replay"; sessionKey: number; from: number; to: number; label: string };
  /** Where Exit goes when there is no previous page on this site. */
  exitHref: string;
  /** Page-specific line under the status chips (Live: no live race, and the previous-race option). */
  notice?: ReactNode;
}

const FRESHNESS_COPY = {
  waiting: { tone: "neutral", text: "Waiting for data" },
  fresh: { tone: "success", text: "Up to date" },
  delayed: { tone: "warning", text: "Delayed" },
  stale: { tone: "danger", text: "Stale" },
  paused: { tone: "neutral", text: "Paused" },
  finished: { tone: "neutral", text: "Session finished" },
  disconnected: { tone: "danger", text: "Source unavailable" },
} as const;

function initialDriverFromUrl(): string | null {
  if (typeof window === "undefined") return null;
  const slug = new URLSearchParams(window.location.search).get("driver");
  return slug && demoEntries().some((e) => e.id === slug) ? slug : null;
}

export function RaceExperience({ geometry, circuit, source, exitHref, notice }: RaceExperienceProps) {
  const reducedMotion = useReducedMotion();
  const webgl = useWebGL();
  const [update, setUpdate] = useState<ProviderUpdate | null>(null);
  const [events, setEvents] = useState<RaceEvent[]>([]);
  // `?driver=<slug>` (e.g. from a driver profile) opens with that driver selected. Driver ids in the demo are the project's driver slugs,
  // the same identity the driver pages use. Read once on the client; on the server there is no URL and no snapshot, so nothing differs.
  const [selected, setSelected] = useState<string | null>(() => initialDriverFromUrl());
  const [hovered, setHovered] = useState<string | null>(null);
  const [focus, setFocus] = useState<readonly string[]>([]);
  const [follow, setFollow] = useState(false);
  const [labelsOn, setLabelsOn] = useState(true);
  const [gapMode, setGapMode] = useState<"leader" | "ahead">("leader");
  const [preset] = useState<ViewPreset>({ name: "overview", nonce: 0 });
  const [fitNonce, setFitNonce] = useState(0);
  const [fitView, setFitView] = useState<RaceView>("overview");
  // The race view is full-window only: a fixed layer over the whole tab. Browser fullscreen (which also hides the browser's toolbars) is
  // an optional extra on top of it, since browsers only allow it after a click; it never changes the layout. "Exit" leaves the page.
  const theater = useRef<HTMLDivElement | null>(null);
  const { nativeFs, fsSupported, toggleBrowserFullscreen, leave } = useImmersive(theater, exitHref, () => setFitNonce((n) => n + 1)); // re-frame on resize
  const [showOrder, setShowOrder] = useState(true);
  const [showEvents, setShowEvents] = useState(false);
  const [viewportW, setViewportW] = useState(1440);
  const [now, setNow] = useState(0);

  const provider = useRef<RaceProvider | null>(null);
  const buffer = useRef(new SnapshotBuffer(250));
  const labels = useRef<HTMLDivElement | null>(null);

  // One world frame for everything: the same transform and centerline the circuit scene builds.
  const frame = useMemo(() => {
    const transform = createWorldTransform(geometry);
    const world = centerlineToWorld(geometry, transform);
    return { transform, path: createTrackPath(world), profile: paceProfile(world) };
  }, [geometry]);

  useEffect(() => {
    const session = { id: source.kind === "demo" ? "apex-demo" : `openf1-${source.sessionKey}`, type: "Race", circuitSlug: circuit.slug, circuitName: circuit.name };
    const p: RaceProvider =
      source.kind === "demo"
        ? new DemoProvider(
            createDemoRace({ entries: demoEntries(), profile: frame.profile, session, totalLaps: source.totalLaps, seed: 2026, baseLapS: source.baseLapS }),
            realScheduler,
            // Read the preference directly: during hydration the hook still reports the server value (false).
            { autoplay: !window.matchMedia("(prefers-reduced-motion: reduce)").matches, speed: 4 },
          )
        : new ReplayProvider({
            load: () => fetchReplayTimeline(source.sessionKey, source.from, source.to),
            coordinateSystem: geometry.coordinateSystem,
            toWorld: frame.transform.toWorld,
            path: frame.path,
            session,
            sourceName: source.label,
          });
    provider.current = p;
    buffer.current = new SnapshotBuffer(p.updateIntervalMs);
    const off = p.subscribe((u) => {
      if (u.snapshot) buffer.current.push(u.snapshot, u.at);
      // After a reset/seek/restart the provider sends the full history to that point: replace the log, so nothing is shown twice.
      if (u.eventsReset) setEvents(appendEvents([], u.events));
      else if (u.events.length) setEvents((log) => appendEvents(log, u.events));
      setUpdate(u);
    });
    p.start();
    return () => {
      off();
      p.dispose();
      provider.current = null;
    };
  }, [source, frame, geometry.coordinateSystem, circuit]);

  useEffect(() => {
    const id = setInterval(() => setNow(performance.now()), 1000);
    return () => clearInterval(id);
  }, []);

  useEffect(() => {
    const onResize = () => setViewportW(window.innerWidth);
    onResize();
    // Phones start with the circuit unobstructed (the race order is one tap away).
    void Promise.resolve().then(() => {
      if (window.innerWidth < 768) setShowOrder(false);
    });
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, []);

  const snapshot = update?.snapshot ?? null;
  const drivers = useMemo(() => (snapshot ? sortByRaceOrder(snapshot.drivers) : []), [snapshot]);
  const byId = useMemo(() => new Map(drivers.map((d) => [d.id, d])), [drivers]);
  const markerDrivers = useMemo(() => drivers.map((d) => ({ id: d.id, color: teamColor(d.teamSlug), position: d.position, stale: d.stale })), [drivers]);
  const battlePairs = useMemo(() => (snapshot ? battles(snapshot) : []), [snapshot]);
  const playing = update?.playback?.playing ?? false;
  const fresh = freshness({ snapshot, receivedAt: update?.at ?? null, now: Math.max(now, update?.at ?? 0), playing, sourceStatus: update?.source.status ?? "connecting" });
  const sel = selected ? byId.get(selected) ?? null : null;
  const mode = snapshot?.mode ?? (source.kind === "demo" ? "DEMO" : "REPLAY");
  const name = (id: string) => byId.get(id)?.code ?? id;
  const fitCircuit = () => {
    setFollow(false);
    setFitView("overview");
    setFitNonce((n) => n + 1);
  };
  const select = useCallback((id: string | null) => {
    setSelected((cur) => (id == null ? null : toggleSelection(cur, id)));
    setFocus([]);
  }, []);
  const selectFromMarker = useCallback((id: string) => select(id), [select]);
  const hover = useCallback((id: string | null) => setHovered(id), []);

  useEffect(() => {
    document.body.style.cursor = hovered ? "pointer" : "";
    return () => {
      document.body.style.cursor = "";
    };
  }, [hovered]);

  const eventText = (e: RaceEvent): string => {
    switch (e.kind) {
      case "overtake":
        return e.passed ? `${name(e.driver)} passes ${name(e.passed)} for P${e.to}` : `${name(e.driver)} up to P${e.to}`;
      case "lap":
        return e.totalLaps ? `Lap ${e.lap} of ${e.totalLaps}` : `Lap ${e.lap}`;
      case "pit-entry":
        return `${name(e.driver)} stops in the pits`;
      case "pit-exit":
        return `${name(e.driver)} rejoins`;
      case "finish":
        return byId.get(e.driver)?.position === 1 ? `${name(e.driver)} takes the chequered flag` : `${name(e.driver)} finishes`;
      case "battle":
        return `Battle: ${name(e.behind)} within a second of ${name(e.ahead)}`;
      case "session":
        return e.status === "running" ? "Session started" : e.status === "finished" ? "Session finished" : `Session ${e.status}`;
    }
  };

  const sessionStatus = snapshot?.session.status ?? "no data";
  const lap = snapshot?.session.lap;
  const laps = snapshot?.session.totalLaps;
  const playback = update?.playback ?? null;
  const finished = sessionStatus === "finished";

  const selectedCard = sel && (
    <div className="rounded-lg border border-line-strong bg-surface p-3" aria-live="polite">
      <div className="flex items-start justify-between gap-3">
        <div className="flex items-center gap-2.5">
          <span aria-hidden="true" className="h-8 w-1 rounded-sm" style={{ backgroundColor: teamColor(sel.teamSlug) }} />
          <div>
            <p className="font-display text-2xl font-semibold leading-none">{sel.code}</p>
            <p className="mt-1 text-xs text-muted">
              {[sel.name, sel.teamSlug ? findTeam(sel.teamSlug)?.name : null, sel.number != null ? `#${sel.number}` : null].filter(Boolean).join(" · ") || "Identity: car number only"}
            </p>
          </div>
        </div>
        <Button size="sm" variant="ghost" onClick={() => select(null)} aria-label="Close driver details">
          Close
        </Button>
      </div>
      <dl className="mt-2 grid grid-cols-3 gap-x-3 gap-y-1.5 text-sm tabular-nums">
        {[
          ["Position", sel.position != null ? `P${sel.position}` : "—"],
          ["Lap", sel.lap != null ? String(sel.lap) : "—"],
          ["Status", sel.finished ? "Finished" : sel.pit === "in-pit" ? "In pit" : sel.pit === "none" ? "Running" : "—"],
          ["To leader", formatGap(sel, "leader")],
          ["Interval", formatGap(sel, "ahead")],
          ["Last lap", formatLapTime(sel.lastLapMs)],
        ].map(([k, v]) => (
          <div key={k}>
            <dt className="text-[11px] uppercase tracking-wider text-subtle">{k}</dt>
            <dd className="font-medium">{v}</dd>
          </div>
        ))}
      </dl>
      <div className="mt-2 flex items-center justify-between gap-2">
        <span className="text-xs text-subtle">Best {formatLapTime(sel.bestLapMs)}</span>
        <Button size="sm" variant="secondary" aria-pressed={follow} onClick={() => setFollow((f) => !f)} className={cn(follow && "!border-accent/70 !text-accent-strong")}>
          {follow ? "Following" : "Follow"}
        </Button>
      </div>
    </div>
  );

  const playbackBar = (
    <div className="flex flex-wrap items-center gap-2 rounded-lg border border-line bg-surface/95 p-1.5 shadow-2">
      <Button size="sm" variant="secondary" className="h-8 min-w-[4.5rem]" disabled={!playback || !snapshot} onClick={() => (playing ? provider.current?.pause() : provider.current?.play())}>
        {playing ? "Pause" : finished ? "Watch again" : snapshot && snapshot.t > 0 ? "Resume" : "Play"}
      </Button>
      <Button size="sm" variant="ghost" className="h-8" disabled={!playback || !snapshot} onClick={() => provider.current?.reset()}>
        Reset
      </Button>
      <label className="flex items-center gap-1.5 text-xs text-muted">
        <span className="sr-only sm:not-sr-only">Speed</span>
        <select
          className="h-8 rounded-md border border-line-strong bg-surface-2 px-1.5 text-sm text-fg disabled:opacity-45"
          value={playback?.speed ?? 1}
          disabled={!playback}
          onChange={(e) => provider.current?.setSpeed(Number(e.target.value))}
          aria-label="Playback speed"
        >
          {PLAYBACK_SPEEDS.map((s) => (
            <option key={s} value={s}>
              {s}×
            </option>
          ))}
        </select>
      </label>
      <input
        type="range"
        min={0}
        max={1000}
        step={1}
        value={Math.round((snapshot?.elapsed ?? 0) * 1000)}
        disabled={!playback || !snapshot}
        onChange={(e) => provider.current?.seek(Number(e.target.value) / 1000)}
        aria-label="Session timeline"
        aria-valuetext={lap != null && laps != null ? `Lap ${lap} of ${laps}` : `${Math.round((snapshot?.elapsed ?? 0) * 100)}% of the recording`}
        className="h-8 min-w-24 flex-1"
      />
      <span className="px-1 text-xs tabular-nums text-muted">{lap != null && laps != null ? `Lap ${lap}/${laps}` : snapshot ? new Date(snapshot.t).toISOString().slice(11, 21) : "—"}</span>
    </div>
  );

  const GLASS =
    "rounded-lg border border-white/10 bg-surface/70 shadow-2 backdrop-blur-xl [box-shadow:inset_0_1px_0_rgb(255_255_255/0.06),var(--shadow-2)] supports-[not(backdrop-filter:blur(1px))]:bg-surface/95";
  const phone = viewportW < 768;
  // Space the floating panels take, so the circuit is framed in what is left (desktop: side panels; phone: top bar and bottom stack).
  // Space the floating panels take (below the site bar and HUD row, above the playback bar). Desktop side insets are symmetric so the
  // circuit stays centred on screen; they shrink when no side panel is open.
  const sidePanels = showOrder || !!sel || showEvents;
  const insets = phone
    ? { top: 112, right: 8, bottom: sel || showOrder ? 300 : 120, left: 8 }
    : { top: 196, right: sidePanels ? 344 : 24, bottom: 92, left: sidePanels ? 344 : 24 };

  const modeBadge = <Badge tone={mode === "LIVE" ? "accent" : mode === "REPLAY" ? "info" : "warning"}>{MODE_LABEL[mode].label}</Badge>;
  const statusText = finished
    ? mode === "DEMO"
      ? "Simulated race finished"
      : "Recording ended"
    : sessionStatus === "running"
      ? playing || mode === "LIVE"
        ? "Running"
        : "Paused"
      : sessionStatus === "not-started"
        ? "Not started"
        : "No data";
  const freshnessChip = (
    <span className="inline-flex items-center gap-1.5 rounded-sm border border-line px-1.5 py-0.5">
      <StatusDot tone={FRESHNESS_COPY[fresh.state].tone} pulse={fresh.state === "fresh" && playing} />
      {FRESHNESS_COPY[fresh.state].text}
    </span>
  );
  const statusChips = (
    <div className="flex flex-wrap items-center gap-2 text-xs text-muted">
      {modeBadge}
      {freshnessChip}
      <span className="rounded-sm border border-line px-1.5 py-0.5">{statusText}</span>
      <span className="rounded-sm border border-line px-1.5 py-0.5 tabular-nums">{lap != null && laps != null ? `Lap ${lap} / ${laps}` : "Lap —"}</span>
    </div>
  );

  const toolButton = (label: string, onClick: () => void, pressed?: boolean, extra?: string) => (
    <Button size="sm" variant="ghost" aria-pressed={pressed} className={cn("h-8 px-2.5", pressed && "text-fg", pressed === false && "text-subtle", extra)} onClick={onClick}>
      {label}
    </Button>
  );
  /** Straight-down view of the whole circuit, framed beside whichever panels are open (top-down never opens or closes them). */
  const topDown = () => {
    setFollow(false);
    setFitView("topDown");
    setFitNonce((n) => n + 1);
  };

  const orderPanel = (
    <section aria-labelledby="order-heading" className="flex min-h-0 flex-col overflow-hidden">
      <div className="flex items-center justify-between gap-2 border-b border-line px-3 py-2">
        <h2 id="order-heading" className="eyebrow">
          {snapshot?.ordered === false ? "Cars" : "Race order"}
        </h2>
        <div role="radiogroup" aria-label="Gap shown" className="flex gap-0.5 text-xs">
          {(["leader", "ahead"] as const).map((g) => (
            <button
              key={g}
              type="button"
              role="radio"
              aria-checked={gapMode === g}
              onClick={() => setGapMode(g)}
              className={cn("motion-interactive rounded-sm px-2 py-1", gapMode === g ? "bg-surface-3 text-fg" : "text-muted hover:text-fg")}
            >
              {g === "leader" ? "To leader" : "Interval"}
            </button>
          ))}
        </div>
      </div>
      <div className="grid grid-cols-[1.75rem_minmax(0,1fr)_4.75rem_4.75rem] gap-2 border-b border-line px-3 py-1 text-[11px] uppercase tracking-wider text-subtle">
        <span>Pos</span>
        <span>Driver</span>
        <span className="text-right">{gapMode === "leader" ? "Gap" : "Int"}</span>
        <span className="text-right">Last lap</span>
      </div>
      <div className="min-h-0 overflow-y-auto">
        {drivers.length ? (
          <Leaderboard drivers={drivers} ordered={snapshot?.ordered ?? false} selected={selected} gapMode={gapMode} onSelect={select} />
        ) : (
          <p className="px-3 py-4 text-sm text-muted" role="status">
            {update?.source.status === "error" ? "No data: the source is unavailable." : "Waiting for the first update…"}
          </p>
        )}
      </div>
      {snapshot?.ordered === false && <p className="border-t border-line px-3 py-2 text-xs text-subtle">This source has no race order or timing; cars are listed by number.</p>}
    </section>
  );

  const eventsPanel = (
    <section aria-labelledby="events-heading" className="flex min-h-0 flex-1 flex-col">
      <div className="flex items-center justify-between gap-2 border-b border-line px-3 py-2">
        <h2 id="events-heading" className="eyebrow">
          Race events
        </h2>
        {battlePairs.length > 0 && <span className="text-xs text-muted">{battlePairs.length} close battle{battlePairs.length === 1 ? "" : "s"}</span>}
      </div>
      {events.length === 0 ? (
        <p className="px-3 py-3 text-sm text-muted">{snapshot?.ordered === false ? "Events need race order, which this source does not provide." : "Overtakes, pit stops and battles will appear here."}</p>
      ) : (
        <ol className="max-h-64 min-h-0 flex-1 divide-y divide-line overflow-y-auto lg:max-h-none">
          {events.map((e) => {
            const ids = e.kind === "battle" ? [e.ahead, e.behind] : "driver" in e ? [e.driver] : [];
            return (
              <li key={e.id}>
                <button
                  type="button"
                  disabled={ids.length === 0}
                  onClick={() => {
                    if (e.kind === "battle") {
                      setSelected(e.behind);
                      setFocus([e.ahead, e.behind]);
                    } else if (ids[0]) select(ids[0]);
                  }}
                  className="motion-interactive flex w-full items-baseline gap-2 px-3 py-1.5 text-left text-sm enabled:hover:bg-surface-2"
                >
                  <span className="w-12 shrink-0 text-[11px] tabular-nums text-subtle">{new Date(e.t).toISOString().slice(14, 19)}</span>
                  <span className={cn(e.kind === "battle" ? "text-info" : e.kind === "overtake" ? "text-fg" : "text-muted")}>{eventText(e)}</span>
                </button>
              </li>
            );
          })}
        </ol>
      )}
    </section>
  );

  // Live page: what is connected. Simulated race: a pointer to where real data is shown instead.
  const sourceLine =
    source.kind === "demo" ? (
      <Link href="/live" className="text-muted underline decoration-line underline-offset-2 hover:text-fg">
        Real data (stored replay, live when connected) is on the Live page.
      </Link>
    ) : (
      <span className="text-muted">Stored replay · live timing is not connected.</span>
    );

  const errorBox = !snapshot && update?.source.status === "error" && (
    // Top centre on desktop, clear of the header card (which carries the page's notice) and the toolbar.
    <div className={cn("pointer-events-auto absolute inset-x-3 top-[7.5rem] z-10 p-4 text-sm md:left-1/2 md:right-auto md:w-[30rem] md:-translate-x-1/2", GLASS, "border-danger/40")} role="alert">
      <p className="font-medium text-danger">The replay source is unavailable</p>
      <p className="mt-1 text-muted">{update.source.detail?.replace(/\.?$/, ".")} The stored replay needs the APEX F1 API (port 8080) with session data ingested.</p>
      <ButtonLink href={`/circuits/${circuit.slug}/race`} size="sm" variant="secondary" className="mt-3">
        Simulated race on this circuit
      </ButtonLink>
    </div>
  );

  return (
    // Full-window: the theater is the whole view; browser fullscreen, when chosen, is requested on this element.
    <div ref={theater} className="fixed inset-0 z-[70] bg-bg">
      <ImmersiveNav
        actions={
          <>
            {fsSupported && (
              <span className="hidden sm:contents">
                <Button size="sm" variant="ghost" aria-pressed={nativeFs} className="h-8 px-2.5" onClick={() => void toggleBrowserFullscreen(!nativeFs)}>
                  {nativeFs ? "Exit browser fullscreen" : "Browser fullscreen"}
                </Button>
              </span>
            )}
            <Button size="sm" variant="secondary" className="h-8 px-2.5" onClick={leave} title="Leave the race view">
              Exit
            </Button>
          </>
        }
      />
            <section
              aria-label={`3D circuit of ${circuit.name} with driver markers`}
              className="absolute inset-0 overflow-hidden bg-bg"
            >
              {webgl === null ? (
                <StageMessage>Loading the 3D circuit…</StageMessage>
              ) : !webgl ? (
                <Unavailable reason="WebGL is not available in this browser." />
              ) : (
                <ErrorBoundary fallback={(e) => <Unavailable reason={e.message} />}>
                  <RaceScene
                    geometry={geometry}
                    preset={preset}
                    fitNonce={fitNonce}
                    insets={insets}
                    view={fitView}
                    drivers={markerDrivers}
                    buffer={buffer}
                    labels={labels}
                    showLabels={labelsOn}
                    selected={selected}
                    focus={hovered ? [...focus, hovered] : focus}
                    follow={follow && !!selected}
                    animating={playing}
                    onSelect={selectFromMarker}
                    onHover={hover}
                  />
                </ErrorBoundary>
              )}

              {/* Driver labels: placed every frame, always touching their marker by the driver layer (lib/race/declutter.ts placeLabels). Mouse users can
                  click a label; keyboard and screen-reader users get the same selection through the race order list. */}
              <div ref={labels} aria-hidden="true" className="pointer-events-none absolute inset-0 overflow-hidden">
                {drivers.map((d) => (
                  <button
                    key={d.id}
                    type="button"
                    tabIndex={-1}
                    data-label-id={d.id}
                    data-visible="false"
                    onClick={() => select(d.id)}
                    className={cn(
                      "pointer-events-auto absolute left-0 top-0 flex items-center gap-1 whitespace-nowrap rounded-sm border bg-bg/80 py-0.5 pl-1 pr-1.5 text-[11px] font-semibold leading-none tabular-nums backdrop-blur-sm transition-opacity duration-150 data-[visible=false]:pointer-events-none data-[visible=false]:opacity-0",
                      d.id === selected ? "border-fg/80 text-fg" : "border-line-strong/70 text-fg/90",
                    )}
                  >
                    <span className="h-3 w-0.5 rounded-sm" style={{ backgroundColor: teamColor(d.teamSlug) }} />
                    {d.position != null && (
                      <span data-pos className="text-muted [[data-compact=true]_&]:hidden">
                        {d.position}
                      </span>
                    )}
                    {d.code}
                    {d.pit === "in-pit" && <span className="text-info">PIT</span>}
                  </button>
                ))}
              </div>

            </section>

            {/* Floating glass HUD. The layer itself ignores the pointer so the circuit can be dragged and zoomed between panels. */}
              <div className="pointer-events-none absolute inset-0 z-10 p-2 pt-14 sm:p-4 sm:pt-16">
                <div className="flex items-start justify-between gap-2">
                  {/* Left column: the race order stacks under the header, so it follows the header's real height (chips wrap, details open). */}
                  <div className="flex min-w-0 flex-col gap-2 md:max-h-[calc(100svh-9.75rem)] md:w-[20rem]">
                  <div className={cn("pointer-events-auto min-w-0 shrink-0 px-3 py-2", GLASS)}>
                    <p className="eyebrow hidden sm:block">Race experience</p>
                    <h1 className="truncate font-display text-lg font-semibold leading-tight sm:text-xl">{circuit.name} · {source.kind === "demo" ? "Simulated race" : "Race"}</h1>
                    <div className="mt-1 hidden sm:block">{statusChips}</div>
                    <div className="mt-1 sm:hidden">{modeBadge}</div>
                    {notice && <p className="mt-1.5 text-xs leading-relaxed text-muted">{notice}</p>}
                    <details className="mt-1.5 text-xs">
                      <summary className="cursor-pointer text-muted hover:text-fg">Source and data</summary>
                      <p className="mt-2">{sourceLine}</p>
                      <p className="mt-2 leading-relaxed text-muted">
                        {mode === "DEMO" && `Simulated race on the ${circuit.name} layout with the project's driver line-up. Positions, gaps, lap times and pit stops are generated by the simulator (base lap time scaled from the circuit's published F1 race lap record); they are not real results.`}
                        {mode === "REPLAY" && source.kind === "replay" && `${source.label}. Stored OpenF1 location samples served by the APEX F1 API: car numbers and positions only, so race order and timing are not available.`}
                        {mode === "LIVE" && MODE_LABEL.LIVE.description}
                        {update?.source.detail && update.source.status !== "error" && <span className="ml-1 text-subtle">{update.source.detail}</span>}
                      </p>
                      <p className="mt-2 text-subtle">
                        Drag to orbit, right-drag or arrow keys to pan, scroll or pinch to zoom. Tap a marker, label or row to select a driver.
                        {reducedMotion && " Reduced motion is on: the demo starts paused."}
                      </p>
                    </details>
                  </div>
                  {showOrder && !phone && <div className={cn("pointer-events-auto flex min-h-0 flex-col overflow-hidden", GLASS)}>{orderPanel}</div>}
                  </div>
                  <div className={cn("pointer-events-auto flex flex-wrap justify-end gap-1 p-1", GLASS)}>
                    <span className="hidden items-center px-1 text-xs text-muted lg:inline-flex">{freshnessChip}</span>
                    {toolButton("Fit", fitCircuit)}
                    <span className="hidden sm:contents">{toolButton("Top-down", topDown)}</span>
                    {toolButton("Labels", () => setLabelsOn((l) => !l), labelsOn)}
                    {toolButton("Order", () => setShowOrder((o) => !o), showOrder)}
                    <span className="hidden sm:contents">{toolButton("Events", () => setShowEvents((o) => !o), showEvents)}</span>
                  </div>
                </div>

                {errorBox}

                {/* Desktop: race order floats on the left, driver details and events on the right. Phone: one bottom sheet at a time. */}
                {showOrder && phone && !sel && (
                  <div
                    className={cn(
                      "pointer-events-auto absolute inset-x-2 bottom-[4.75rem] flex max-h-[42vh] flex-col overflow-hidden",
                      GLASS,
                    )}
                  >
                    {orderPanel}
                  </div>
                )}
                {!phone && (sel || showEvents) && (
                  <div className="pointer-events-none absolute bottom-[5.75rem] right-4 top-[8.5rem] flex w-[18.5rem] flex-col gap-2">
                    {sel && <div className="pointer-events-auto shrink-0 [&>div]:border-white/10 [&>div]:bg-surface/70 [&>div]:backdrop-blur-xl">{selectedCard}</div>}
                    {showEvents && <div className={cn("pointer-events-auto flex min-h-0 flex-col overflow-hidden", GLASS)}>{eventsPanel}</div>}
                  </div>
                )}
                {phone && sel && <div className="pointer-events-auto absolute inset-x-2 bottom-[4.75rem] [&>div]:bg-surface/80 [&>div]:backdrop-blur-xl">{selectedCard}</div>}

                <div className="pointer-events-none absolute inset-x-2 bottom-2 flex justify-center sm:inset-x-4 sm:bottom-4">
                  <div className="pointer-events-auto w-full max-w-3xl [&>div]:border-white/10 [&>div]:bg-surface/70 [&>div]:backdrop-blur-xl">{playbackBar}</div>
                </div>
              </div>
    </div>
  );
}

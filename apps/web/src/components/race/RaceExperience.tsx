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
import { findTeamBySlug } from "@/lib/teams/registry";
import { centerlineToWorld, createWorldTransform } from "@/lib/circuit/transform";
import type { CircuitGeometry } from "@/lib/circuit/types";
import { cn } from "@/lib/cn";
import { createDemoRace, paceProfile } from "@/lib/race/demo";
import { demoEntries, driverColor, NEUTRAL_MARKER } from "@/lib/race/entries";
import { appendEvents, type RaceEvent } from "@/lib/race/events";
import { DemoProvider, PLAYBACK_SPEEDS, ReplayProvider, realScheduler, type ProviderUpdate, type RaceProvider } from "@/lib/race/providers";
import { MODE_LABEL, SnapshotBuffer, battles, formatGap, formatLapTime, freshness, sortByRaceOrder, toggleSelection } from "@/lib/race/session";
import type { RaceView } from "@/lib/race/fit";
import { createTrackPath } from "@/lib/race/track";
import { fetchReplayTimeline } from "@/lib/replay/api";
import { ReplayModel } from "@/lib/replay/model";
import { loadReplayOffThread } from "@/lib/replay/loadOffThread";
import { HistoricalReplayProvider } from "@/lib/replay/provider";
import { ComparePanel } from "@/components/replay/ComparePanel";
import { ComparePicker } from "@/components/replay/ComparePicker";
import { CircuitFocus } from "./CircuitFocus";
import { RaceControlPanel } from "@/components/replay/RaceControlPanel";
import { EngineerPanel } from "@/components/engineer/EngineerPanel";
import { RewindPanel } from "@/components/replay/RewindPanel";
import { messageText, RaceControl, weatherAt, type TrackStatus } from "@/lib/replay/raceControl";
import { EVENT_LEAD_IN_MS } from "@/lib/replay/model";
import { emphasis, isHollow, reconcile, type FocusSet } from "@/lib/race/visibility";
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
    | { kind: "replay"; sessionKey: number; from: number; to: number; label: string }
    /** A full recorded race (lib/replay): one validated dataset file, fetched from this site. */
    | { kind: "history"; sessionKey: number; url: string; label: string };
  /** Where Exit goes when there is no previous page on this site. */
  exitHref: string;
  /** Page-specific line under the status chips (Live: no live race, and the previous-race option). */
  notice?: ReactNode;
  /** Session key whose fastest laps the Telemetry Lab has (links the replay comparison to it), when exported. */
  telemetrySessionKey?: number | null;
}

/** Track status (calculated from race-control messages; see lib/replay/raceControl). */
const STATUS_LABEL: Record<TrackStatus, string> = { "not-started": "Before the start", green: "Track green", yellow: "Yellow flag", vsc: "Virtual Safety Car", "safety-car": "Safety Car", "red-flag": "Red flag", finished: "Chequered flag" };
const STATUS_TONE: Record<TrackStatus, string> = {
  "not-started": "border-white/15 text-muted",
  green: "border-success/50 text-success",
  yellow: "border-warning/60 text-warning",
  vsc: "border-warning/60 text-warning",
  "safety-car": "border-warning/70 bg-warning/10 text-warning",
  "red-flag": "border-danger/70 bg-danger/10 text-danger",
  finished: "border-white/25 text-fg",
};

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

export function RaceExperience({ geometry, circuit, source, exitHref, notice, telemetrySessionKey = null }: RaceExperienceProps) {
  const reducedMotion = useReducedMotion();
  const webgl = useWebGL();
  const [update, setUpdate] = useState<ProviderUpdate | null>(null);
  // Capabilities of sources with an exact clock (historical replay), known once the dataset has loaded.
  const [caps, setCaps] = useState<(Pick<RaceProvider, "speeds" | "timeline"> & { model: ReplayModel }) | null>(null);
  // Two-driver comparison (recorded replays): picking, then active with A and B. Uses the same focus highlight as battles.
  // `resume`: the picker was opened from an active comparison ("Change"), so Cancel returns to it instead of ending it.
  const [compare, setCompare] = useState<{ stage: "pick" | "active"; a: string | null; b: string | null; resume?: boolean } | null>(null);
  // Circuit focus: the user's single source of truth for which drivers stay prominent (lib/race/visibility). Comparison never writes it.
  const [focusSet, setFocusSet] = useState<FocusSet>(null);
  const [focusOpen, setFocusOpen] = useState(false);
  const [wideCompare, setWideCompare] = useState(false);
  // The last compared pair, so reopening the picker (after Exit, or an accidental double-click) starts from it.
  const [lastPair, setLastPair] = useState<[string, string] | null>(null);
  // Race control & conditions (Phase 12): its panel, and the approximate sector-flag shading on the circuit (on by default).
  const [rcOpen, setRcOpen] = useState(false);
  // AI Race Engineer (Phase 14): its panel, kept mounted once opened so the conversation survives closing it.
  const [engOpen, setEngOpen] = useState(false);
  const [engMounted, setEngMounted] = useState(false);
  const [engPrefill, setEngPrefill] = useState<{ id: number; text: string } | null>(null);
  // Race Rewind (Phase 15): why the selected driver gained or lost each place.
  const [rewindOpen, setRewindOpen] = useState(false);
  // Whether the comparison PANEL is open. The comparison itself (pair, highlight, on-screen bar) stays active when another panel takes the
  // right-hand area; that panel's Close then closes only itself, and the Compare button reopens the comparison where it was left.
  const [compareShown, setCompareShown] = useState(true);
  const [sectorOverlay, setSectorOverlay] = useState(true);
  // Where the HUD toolbar ends (it wraps to more rows on narrow screens): phone panels start just below it instead of a guessed offset.
  const toolbarRef = useRef<HTMLDivElement | null>(null);
  const [toolbarBottom, setToolbarBottom] = useState(112);
  useEffect(() => {
    const el = toolbarRef.current;
    if (!el) return;
    const ro = new ResizeObserver(() => setToolbarBottom(Math.round(el.getBoundingClientRect().bottom)));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  // While comparing, the pair is emphasised unless the user chose "Show all" (the comparison itself stays open). A new pair re-enables it.
  const [compareHighlight, setCompareHighlight] = useState(true);
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
  // OpenF1 location -> world plane (x, z): stable per circuit, so analyses keyed on it are not recomputed on every replay update.
  const toPlane = useMemo(
    () =>
      (x: number, y: number): [number, number] => {
        const w = frame.transform.toWorld(x, y, frame.transform.origin[2]);
        return [w[0], w[2]];
      },
    [frame],
  );

  useEffect(() => {
    const attach = (p: RaceProvider) => {
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
    };
    if (source.kind === "history") {
      // Load, validate and index one race; a newer request (or unmount) supersedes it, so a stale response is never applied.
      const ctrl = new AbortController();
      let detach: (() => void) | null = null;
      const fail = (detail: string) => setUpdate({ snapshot: null, source: { status: "error", detail }, playback: null, at: performance.now(), events: [], eventsReset: true });
      loadReplayOffThread(source.url, geometry, ctrl.signal)
        .then(({ ds, progress }) => {
          if (ctrl.signal.aborted) return;
          const model = new ReplayModel(ds, null, progress);
          const p = new HistoricalReplayProvider(model, { circuitSlug: circuit.slug, circuitName: circuit.name });
          setCaps({ speeds: p.speeds, timeline: p.timeline, model: p.model });
          detach = attach(p);
          // `#t=<ms>` (links from the Race Engineer page): start at that moment, with the usual lead-in.
          const at = /^#t=(\d+)$/.exec(window.location.hash);
          if (at) p.seekTime(Math.max(0, Number(at[1]) - EVENT_LEAD_IN_MS));
        })
        .catch((e: unknown) => {
          if (!ctrl.signal.aborted) fail(e instanceof Error ? e.message : "the replay could not be loaded");
        });
      return () => {
        ctrl.abort();
        detach?.();
      };
    }
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
    return attach(p);
  }, [source, frame, geometry, circuit]);

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
  const presentIds = useMemo(() => new Set(drivers.map((d) => d.id)), [drivers]);
  const comparePair: [string, string] | null = compare?.stage === "active" && compare.a && compare.b ? [compare.a, compare.b] : null;
  const emph = emphasis(focusSet, compareHighlight ? comparePair : null, presentIds);
  // Visual only: positions, order and timing come from the snapshot unchanged. Rebuilt with each update (as before), so a focus change
  // costs one redraw and no extra work per frame.
  const markerDrivers = drivers.map((d) => ({ id: d.id, color: driverColor(d), position: d.position, stale: d.stale, hollow: isHollow(emph, d.id) }));
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
      case "official":
        return `Race control: ${messageText(e.text)}`;
      case "pit-stop":
        return `${name(e.driver)} pit stop${e.lap ? ` on lap ${e.lap}` : ""}${e.laneS ? ` (${e.laneS.toFixed(1)} s in the pit lane)` : ""}`;
      case "position":
        return `${name(e.driver)} ${e.to < e.from ? "up" : "down"} to P${e.to} (timing feed)`;
    }
  };

  const sessionStatus = snapshot?.session.status ?? "no data";
  const lap = snapshot?.session.lap;
  // Race clock for exact-clock replays: time since lights out (negative on the grid).
  const raceClock = (() => {
    if (!caps?.timeline || !snapshot) return null;
    const s = Math.round((snapshot.t - caps.timeline.lightsOutMs) / 1000);
    const a = Math.abs(s);
    return `${s < 0 ? "−" : ""}${Math.floor(a / 3600)}:${String(Math.floor((a % 3600) / 60)).padStart(2, "0")}:${String(a % 60).padStart(2, "0")}`;
  })();
  const laps = snapshot?.session.totalLaps;
  const playback = update?.playback ?? null;
  const finished = sessionStatus === "finished";

  const selectedCard = sel && (
    <div className="rounded-lg border border-line-strong bg-surface p-3" aria-live="polite">
      <div className="flex items-start justify-between gap-3">
        <div className="flex items-center gap-2.5">
          <span aria-hidden="true" className="h-8 w-1 rounded-sm" style={{ backgroundColor: driverColor(sel) }} />
          <div>
            <p className="font-display text-2xl font-semibold leading-none">{sel.code}</p>
            <p className="mt-1 text-xs text-muted">
              {[sel.name, sel.teamSlug ? findTeamBySlug(sel.teamSlug)?.name : null, sel.number != null ? `#${sel.number}` : null].filter(Boolean).join(" · ") || "Identity: car number only"}
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
    <div className={cn("flex flex-wrap items-center gap-2 rounded-lg border border-line bg-surface/95 p-1.5 shadow-2", caps?.timeline && "[&>.timeline]:order-first [&>.timeline]:basis-full")}>
      <Button size="sm" variant="secondary" className="h-8 min-w-[4.5rem]" disabled={!playback || !snapshot} onClick={() => (playing ? provider.current?.pause() : provider.current?.play())}>
        {playing ? "Pause" : finished ? "Watch again" : snapshot && snapshot.t > 0 ? "Resume" : "Play"}
      </Button>
      <Button size="sm" variant="ghost" className="h-8" disabled={!playback || !snapshot} onClick={() => provider.current?.reset()}>
        Reset
      </Button>
      {caps?.timeline && (
        <>
          <Button size="sm" variant="ghost" className="h-8 px-2" disabled={!snapshot} aria-label="−10 s: back 10 seconds" onClick={() => provider.current?.step?.(-10_000)}>
            −10 s
          </Button>
          <Button size="sm" variant="ghost" className="h-8 px-2" disabled={!snapshot} aria-label="+10 s: forward 10 seconds" onClick={() => provider.current?.step?.(10_000)}>
            +10 s
          </Button>
        </>
      )}
      <label className="flex items-center gap-1.5 text-xs text-muted">
        <span className="sr-only sm:not-sr-only">Speed</span>
        <select
          className="h-8 rounded-md border border-line-strong bg-surface-2 px-1.5 text-sm text-fg disabled:opacity-45"
          value={playback?.speed ?? 1}
          disabled={!playback}
          onChange={(e) => provider.current?.setSpeed(Number(e.target.value))}
          aria-label="Playback speed"
        >
          {(caps?.speeds ?? PLAYBACK_SPEEDS).map((s) => (
            <option key={s} value={s}>
              {s}×
            </option>
          ))}
        </select>
      </label>
      <div className="timeline relative min-w-24 flex-1 px-1">
        <input
          type="range"
          min={0}
          max={1000}
          step={1}
          value={Math.round((snapshot?.elapsed ?? 0) * 1000)}
          disabled={!playback || !snapshot}
          onChange={(e) => provider.current?.seek(Number(e.target.value) / 1000)}
          aria-label="Session timeline"
          aria-valuetext={`${raceClock ?? ""}${lap != null && laps != null ? ` · lap ${lap} of ${laps}` : raceClock ? "" : `${Math.round((snapshot?.elapsed ?? 0) * 100)}% of the recording`}`}
          className="block h-8 w-full"
        />
        {/* Sourced moments under the track, each one seeks there: Safety Car / VSC periods as bands, other official moments and pit stops as ticks. */}
        {caps?.timeline && (
          <div className="pointer-events-none absolute inset-x-0 bottom-0 h-2">
            {caps.timeline.markers.map((m, i) => {
              const d = caps.timeline!.durationMs;
              const band = m.end != null;
              return (
                <button
                  key={`${m.t}-${i}`}
                  type="button"
                  title={band ? `${m.label}: ${Math.round((m.end! - m.t) / 1000)} s` : m.label}
                  aria-label={`Go to: ${m.label}`}
                  tabIndex={m.kind === "pit" ? -1 : 0}
                  onClick={() => provider.current?.seekTime?.(Math.max(0, m.t - EVENT_LEAD_IN_MS))}
                  className={cn(
                    "pointer-events-auto absolute bottom-0 rounded-full focus-visible:outline-2",
                    band ? "h-1.5 min-w-1.5" : "-translate-x-1/2",
                    m.kind === "pit" && "z-0 h-1.5 w-1 bg-subtle/60",
                    m.kind === "safety-car" && "z-10 bg-warning",
                    m.kind === "red-flag" && cn("z-20 bg-danger", band ? "h-1.5" : "h-2 w-1.5"),
                    (m.kind === "start" || m.kind === "finish") && "z-20 h-2 w-1.5 bg-fg",
                  )}
                  style={{ left: `${(m.t / d) * 100}%`, width: band ? `${((m.end! - m.t) / d) * 100}%` : undefined }}
                />
              );
            })}
          </div>
        )}
      </div>
      <span className="ml-auto px-1 text-xs tabular-nums text-muted">
        {lap != null && laps != null ? `Lap ${lap}/${laps}` : ""}
        {raceClock ? `${lap != null && laps != null ? " · " : ""}${raceClock}` : lap == null && snapshot ? new Date(snapshot.t).toISOString().slice(11, 21) : ""}
      </span>
    </div>
  );

  const GLASS =
    "rounded-lg border border-white/10 bg-surface/70 shadow-2 backdrop-blur-xl [box-shadow:inset_0_1px_0_rgb(255_255_255/0.06),var(--shadow-2)] supports-[not(backdrop-filter:blur(1px))]:bg-surface/95";
  const phone = viewportW < 768;
  // Space the floating panels take, so the circuit is framed in what is left (desktop: side panels; phone: top bar and bottom stack).
  // Space the floating panels take (below the site bar and HUD row, above the playback bar). Desktop side insets are symmetric so the
  // circuit stays centred on screen; they shrink when no side panel is open.
  // One docked panel (Drivers, Race control or the Engineer) owns the right-hand area at a time.
  const dockOpen = focusOpen || rcOpen || engOpen || rewindOpen;
  const comparePanel = !!compare && compareShown && !dockOpen;
  const sidePanels = showOrder || !!sel || showEvents || comparePanel || dockOpen;
  // The comparison column is wider (22.5rem, or 36rem "wide") than the driver/events column (18.5rem). Wide frames the circuit off-centre
  // (between the race order and the panel) rather than shrinking it to a sliver.
  const side = comparePanel ? 392 : 344;
  const insets = phone
    ? { top: 112, right: 8, bottom: comparePanel ? 420 : sel || showOrder ? 300 : 120, left: 8 }
    : comparePanel && wideCompare
      ? { top: 196, right: 600, bottom: 92, left: showOrder ? 344 : 24 }
      : { top: 196, right: sidePanels ? side : 24, bottom: 92, left: sidePanels ? side : 24 };

  // Comparison: drivers by id <-> model index, the active pair highlighted on the circuit with the battle focus ring.
  const model = caps?.model ?? null;
  const rc = useMemo(() => (model ? new RaceControl(model) : null), [model]);
  const rcT = snapshot?.t ?? 0;
  const trackStatus = rc ? rc.statusAt(rcT) : null;
  const sectorFlagsNow = rc ? [...rc.sectorFlags(rcT)] : [];
  const weatherNow = rc && model ? weatherAt(model.ds.weather, rcT) : null;
  const indexOf = (id: string | null) => (model && id ? model.ds.drivers.findIndex((d) => `car-${d.number}` === id) : -1);
  const comparing = compare?.stage === "active" && indexOf(compare.a) >= 0 && indexOf(compare.b) >= 0;
  const shownFocus = comparing ? [compare!.a!, compare!.b!] : focus;
  const pickDrivers = model
    ? model.ds.drivers.map((d) => ({ id: `car-${d.number}`, number: d.number, code: d.acronym ?? `#${d.number}`, name: d.fullName, team: d.team, colour: d.teamColour ?? NEUTRAL_MARKER, position: byId.get(`car-${d.number}`)?.position ?? null })).sort((x, y) => (x.position ?? 99) - (y.position ?? 99))
    : [];
  const startCompare = () => {
    setFocusOpen(false);
    setRcOpen(false);
    setEngOpen(false);
    setRewindOpen(false);
    setCompareShown(true);
    const a = compare?.a ?? selected ?? lastPair?.[0] ?? null;
    const b = compare?.b ?? (lastPair && lastPair[1] !== a ? lastPair[1] : lastPair && lastPair[0] !== a ? lastPair[0] : null);
    setCompare({ stage: "pick", a, b });
  };
  /**
   * The toolbar's Compare button does what its state suggests: nothing open -> choose drivers; a comparison hidden under the Drivers panel
   * -> show it again; the picker opened from "Change" -> back to that comparison; the comparison showing -> end it (same as its Exit).
   */
  const onCompareButton = () => {
    if (!compare) startCompare();
    else if (!comparePanel) {
      // Comparison active but its panel closed (another panel took the area): reopen it as it was.
      setFocusOpen(false);
      setRcOpen(false);
      setEngOpen(false);
      setRewindOpen(false);
      setCompareShown(true);
    } else if (compare.stage === "pick" && compare.resume && compare.a && compare.b) setCompare({ stage: "active", a: compare.a, b: compare.b });
    else setCompare(null);
  };
  /** Race control and Drivers take the right-hand area by closing the comparison panel (not stacking over it). */
  const openDock = (which: "rc" | "focus" | "eng" | "rewind" | null) => {
    setRcOpen(which === "rc");
    setEngOpen(which === "eng");
    setRewindOpen(which === "rewind");
    if (which === "eng") setEngMounted(true);
    setFocusOpen(which === "focus");
    if (which) setCompareShown(false);
  };
  const comparePane = compare && model && (
    <div className={cn("pointer-events-auto flex min-h-0 flex-col overflow-hidden", GLASS)}>
      {compare.stage === "pick" || !comparing ? (
        <ComparePicker
          drivers={pickDrivers}
          initialA={compare.a}
          initialB={compare.b}
          onCancel={() => setCompare(compare.resume && compare.a && compare.b ? { stage: "active", a: compare.a, b: compare.b } : null)}
          onStart={(a, b) => {
            setSelected(null);
            setCompareHighlight(true);
            setLastPair([a, b]);
            setCompareShown(true);
            setCompare({ stage: "active", a, b });
          }}
        />
      ) : (
        <ComparePanel
          model={model}
          lapLength={frame.path.length}
          t={snapshot?.t ?? 0}
          a={indexOf(compare.a)}
          b={indexOf(compare.b)}
          teamColour={(i) => model.ds.drivers[i].teamColour ?? NEUTRAL_MARKER}
          onSeek={(t) => provider.current?.seekTime?.(t)}
          onSwitch={() => setCompare({ ...compare, stage: "pick", resume: true })}
          onExit={() => setCompare(null)}
          telemetrySessionKey={telemetrySessionKey}
          path={frame.path}
          toWorld={toPlane}
          wide={wideCompare}
          onToggleWide={phone ? null : () => setWideCompare((w) => !w)}
        />
      )}
    </div>
  );

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
      {/* Not repeated when the freshness chip already says the same ("Paused"). */}
      {statusText !== FRESHNESS_COPY[fresh.state].text && <span className="rounded-sm border border-line px-1.5 py-0.5">{statusText}</span>}
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
                  disabled={ids.length === 0 && !caps?.timeline}
                  onClick={() => {
                    provider.current?.seekTime?.(Math.max(0, e.t - EVENT_LEAD_IN_MS));
                    if (e.kind === "battle") {
                      setSelected(e.behind);
                      setFocus([e.ahead, e.behind]);
                    } else if (ids[0]) select(ids[0]);
                  }}
                  className="motion-interactive flex w-full items-baseline gap-2 px-3 py-1.5 text-left text-sm enabled:hover:bg-surface-2"
                >
                  <span className="w-12 shrink-0 text-[11px] tabular-nums text-subtle">
                    {caps?.timeline ? `${Math.round((e.t - caps.timeline.lightsOutMs) / 60000)}′` : new Date(e.t).toISOString().slice(14, 19)}
                  </span>
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
      <span className="text-muted">{source.kind === "history" ? "Recorded race · OpenF1" : "Stored replay · live timing is not connected."}</span>
    );

  const errorBox = !snapshot && update?.source.status === "error" && (
    // Top centre on desktop, clear of the header card (which carries the page's notice) and the toolbar.
    <div className={cn("pointer-events-auto absolute inset-x-3 top-[7.5rem] z-10 p-4 text-sm md:left-1/2 md:right-auto md:w-[30rem] md:-translate-x-1/2", GLASS, "border-danger/40")} role="alert">
      <p className="font-medium text-danger">{source.kind === "history" ? "This replay could not be loaded" : "The replay source is unavailable"}</p>
      <p className="mt-1 text-muted">
        {source.kind === "history"
          ? `The race data could not be loaded: ${update.source.detail ?? "unknown error"}. Nothing is shown rather than guessed.`
          : `${update.source.detail?.replace(/\.?$/, ".")} The stored replay needs the APEX F1 API (port 8080) with session data ingested.`}
      </p>
      <ButtonLink href={source.kind === "history" ? "/replay" : `/circuits/${circuit.slug}/race`} size="sm" variant="secondary" className="mt-3">
        {source.kind === "history" ? "All replays" : "Simulated race on this circuit"}
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
                    sectorFlags={rc && sectorOverlay && rc.sectorCount ? { count: rc.sectorCount, flags: sectorFlagsNow } : null}
                    neutral={trackStatus === "safety-car" || trackStatus === "vsc" ? { kind: trackStatus, leaderId: drivers.find((d) => d.position === 1)?.id ?? null } : null}
                    drivers={markerDrivers}
                    buffer={buffer}
                    labels={labels}
                    showLabels={labelsOn}
                    selected={selected}
                    focus={hovered ? [...shownFocus, hovered] : shownFocus}
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
                {/* Safety Car (approximate: its position is not in the data) and VSC tags, placed by the driver layer. */}
                {(trackStatus === "safety-car" || trackStatus === "vsc") && (
                  <span
                    data-label-id={trackStatus === "safety-car" ? "__sc" : "__vsc"}
                    data-visible="false"
                    className="absolute left-0 top-0 whitespace-nowrap rounded-sm border border-[#ffd60a]/80 bg-bg/85 px-1.5 py-0.5 text-[11px] font-semibold leading-none text-[#ffd60a] transition-opacity duration-150 data-[visible=false]:opacity-0"
                  >
                    {trackStatus === "safety-car" ? "SC (approx.)" : "VSC"}
                  </span>
                )}
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
                    <span className="h-3 w-0.5 rounded-sm" style={{ backgroundColor: driverColor(d) }} />
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
                    {trackStatus && (
                      <div className="mt-1.5 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs">
                        <span className={cn("rounded-sm border px-1.5 py-0.5 font-medium", STATUS_TONE[trackStatus])}>
                          {STATUS_LABEL[trackStatus]}
                          {trackStatus === "yellow" && sectorFlagsNow.length > 0 && ` · sector${sectorFlagsNow.length > 1 ? "s" : ""} ${sectorFlagsNow.map(([k]) => k).join(", ")}`}
                        </span>
                        {sectorOverlay && sectorFlagsNow.length > 0 && <span className="text-[11px] text-subtle">shaded on the circuit (approx.)</span>}
                        {weatherNow && (
                          <span className="tabular-nums text-muted">
                            {weatherNow.airC != null && `Air ${Math.round(weatherNow.airC)}°`}
                            {weatherNow.trackC != null && ` · Track ${Math.round(weatherNow.trackC)}°`}
                            {weatherNow.rain && <span className="text-info"> · Rain</span>}
                          </span>
                        )}
                      </div>
                    )}
                    <div className="mt-1 sm:hidden">{modeBadge}</div>
                    {/* A div, not a p: notices may hold block content (the live-timing status and its running order). */}
                    {notice && <div className="mt-1.5 text-xs leading-relaxed text-muted">{notice}</div>}
                    <details className="mt-1.5 text-xs">
                      <summary className="cursor-pointer text-muted hover:text-fg">Source and data</summary>
                      <p className="mt-2">{sourceLine}</p>
                      <p className="mt-2 leading-relaxed text-muted">
                        {mode === "DEMO" && `Simulated race on the ${circuit.name} layout with the project's driver line-up. Positions, gaps, lap times and pit stops are generated by the simulator (base lap time scaled from the circuit's published F1 race lap record); they are not real results.`}
                        {mode === "REPLAY" && source.kind === "replay" && `${source.label}. Stored OpenF1 location samples served by the APEX F1 API: car numbers and positions only, so race order and timing are not available.`}
                        {mode === "REPLAY" &&
                          source.kind === "history" &&
                          `${source.label}. Recorded OpenF1 data: car positions (samples at least 1 s apart; between samples cars move along the track in proportion to time, and gaps over 5 s are not bridged), the official running order, published gaps, lap times, pit stops and race-control messages, each as of the replay time. Position changes are from the timing feed and include pit cycles, so they are not called overtakes.`}
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
                  <div ref={toolbarRef} className={cn("pointer-events-auto flex flex-wrap justify-end gap-1 p-1", GLASS)}>
                    <span className="hidden items-center px-1 text-xs text-muted lg:inline-flex">{freshnessChip}</span>
                    {toolButton("Fit", fitCircuit)}
                    <span className="hidden sm:contents">{toolButton("Top-down", topDown)}</span>
                    {toolButton("Labels", () => setLabelsOn((l) => !l), labelsOn)}
                    {toolButton("Order", () => setShowOrder((o) => !o), showOrder)}
                    <span className="hidden sm:contents">{toolButton("Events", () => setShowEvents((o) => !o), showEvents)}</span>
                    {toolButton(emph.source === "focus" ? `Drivers · ${emph.prominent!.size}` : "Drivers", () => {
                      openDock(focusOpen ? null : "focus");
                    }, focusOpen || emph.source === "focus")}
                    {rc && toolButton("Race control", () => {
                      openDock(rcOpen ? null : "rc");
                    }, rcOpen)}
                    {model && toolButton("Compare", onCompareButton, comparePanel)}
                    {model && toolButton("Rewind", () => openDock(rewindOpen ? null : "rewind"), rewindOpen)}
                    {model && source.kind === "history" && toolButton("Engineer", () => openDock(engOpen ? null : "eng"), engOpen)}
                  </div>
                </div>

                {errorBox}

                {/* Desktop: race order floats on the left, driver details and events on the right. Phone: one bottom sheet at a time. */}
                {showOrder && phone && !sel && !comparePanel && !dockOpen && (
                  <div
                    className={cn(
                      "pointer-events-auto absolute inset-x-2 bottom-[4.75rem] flex max-h-[42vh] flex-col overflow-hidden",
                      GLASS,
                    )}
                  >
                    {orderPanel}
                  </div>
                )}
                {/* One owner of the right-hand area at a time: Circuit focus while it is open, else the comparison, else the driver card and
                    events. The comparison stays mounted (hidden) under the focus panel, so its tab and lap choices survive; each panel keeps
                    one container across phone and desktop layouts, so crossing the breakpoint does not reset it. */}
                {compare && (
                  <div
                    className={cn(
                      "pointer-events-none absolute flex flex-col",
                      !comparePanel && "hidden",
                      phone ? "inset-x-2 bottom-[9.25rem] max-h-[52svh]" : cn("bottom-[5.75rem] right-4 top-[8.5rem]", wideCompare ? "w-[36rem]" : "w-[22.5rem]"),
                    )}
                  >
                    {comparePane}
                  </div>
                )}
                {focusOpen && (
                  <div className={cn("pointer-events-none absolute z-20 flex flex-col", phone ? "inset-x-2 bottom-[9.25rem]" : "bottom-[5.75rem] right-4 top-[8.5rem] w-[20rem]")} style={phone ? { top: toolbarBottom + 8 } : undefined}>
                    <div className={cn("pointer-events-auto flex min-h-0 flex-col overflow-hidden", GLASS)}>
                      <CircuitFocus
                        drivers={drivers.map((d) => ({ id: d.id, code: d.code, name: d.name, team: d.teamSlug ? (findTeamBySlug(d.teamSlug)?.name ?? null) : null, number: d.number, colour: driverColor(d), position: d.position, hollow: isHollow(emph, d.id) }))}
                        applied={reconcile(focusSet, presentIds)}
                        comparing={comparePair && emph.source === "compare" ? [byId.get(comparePair[0])?.code ?? comparePair[0], byId.get(comparePair[1])?.code ?? comparePair[1]] : null}
                        onApply={(f) => {
                          setFocusSet(f);
                          setFocusOpen(false);
                        }}
                        onClose={() => setFocusOpen(false)}
                      />
                    </div>
                  </div>
                )}
                {rc && rcOpen && model && (
                  <div className={cn("pointer-events-none absolute z-20 flex flex-col", phone ? "inset-x-2 bottom-[9.25rem]" : "bottom-[5.75rem] right-4 top-[8.5rem] w-[22.5rem]")} style={phone ? { top: toolbarBottom + 8 } : undefined}>
                    <div className={cn("pointer-events-auto flex min-h-0 flex-col overflow-hidden", GLASS)}>
                      <RaceControlPanel
                        rc={rc}
                        weather={model.ds.weather}
                        t={rcT}
                        lightsOutMs={model.ds.lightsOutMs}
                        durationMs={model.ds.durationMs}
                        onSeek={(t) => provider.current?.seekTime?.(t)}
                        onClose={() => setRcOpen(false)}
                        showSectorFlags={sectorOverlay}
                        onToggleSectorFlags={() => setSectorOverlay((v) => !v)}
                      />
                    </div>
                  </div>
                )}
                {rewindOpen && model && (
                  <div className={cn("pointer-events-none absolute z-20 flex flex-col", phone ? "inset-x-2 bottom-[9.25rem]" : "bottom-[5.75rem] right-4 top-[8.5rem] w-[22.5rem]")} style={phone ? { top: toolbarBottom + 8 } : undefined}>
                    <div className={cn("pointer-events-auto flex min-h-0 flex-1 flex-col overflow-hidden", GLASS)}>
                      <RewindPanel
                        model={model}
                        t={rcT}
                        initialNumber={selected ? Number(selected.replace("car-", "")) : null}
                        onSeek={(t) => provider.current?.seekTime?.(t)}
                        onAsk={
                          source.kind === "history"
                            ? (text) => {
                                setEngPrefill((p) => ({ id: (p?.id ?? 0) + 1, text }));
                                openDock("eng");
                              }
                            : undefined
                        }
                        onClose={() => setRewindOpen(false)}
                      />
                    </div>
                  </div>
                )}
                {engMounted && model && source.kind === "history" && (
                  <div className={cn("pointer-events-none absolute z-20 flex flex-col", !engOpen && "hidden", phone ? "inset-x-2 bottom-[9.25rem]" : "bottom-[5.75rem] right-4 top-[8.5rem] w-[24rem]")} style={phone ? { top: toolbarBottom + 8 } : undefined}>
                    <div className={cn("pointer-events-auto flex min-h-0 flex-1 flex-col overflow-hidden", GLASS)}>
                      <EngineerPanel sessionKey={source.sessionKey} t={rcT} onSeek={(t) => provider.current?.seekTime?.(Math.max(0, t - EVENT_LEAD_IN_MS))} onClose={() => setEngOpen(false)} prefill={engPrefill} />
                    </div>
                  </div>
                )}
                {!phone && !comparePanel && !dockOpen && (sel || showEvents) && (
                  <div className="pointer-events-none absolute bottom-[5.75rem] right-4 top-[8.5rem] flex w-[18.5rem] flex-col gap-2">
                    {sel && <div className="pointer-events-auto shrink-0 [&>div]:border-white/10 [&>div]:bg-surface/70 [&>div]:backdrop-blur-xl">{selectedCard}</div>}
                    {showEvents && <div className={cn("pointer-events-auto flex min-h-0 flex-col overflow-hidden", GLASS)}>{eventsPanel}</div>}
                  </div>
                )}
                {phone && sel && !comparePanel && !dockOpen && <div className="pointer-events-auto absolute inset-x-2 bottom-[4.75rem] [&>div]:bg-surface/80 [&>div]:backdrop-blur-xl">{selectedCard}</div>}

                {/* On-screen "Show all" whenever drivers are hollowed out (or a comparison could re-focus them); hidden while the Drivers panel is open.
                    Phones: below the toolbar, which wraps to two rows there. */}
                {!dockOpen && (emph.source !== "all" || comparePair) && (
                  <div className={cn("pointer-events-none absolute inset-x-2 flex justify-center", !phone && "bottom-[7.75rem]")} style={phone ? { top: toolbarBottom + 8 } : undefined}>
                    <div role="status" className={cn("pointer-events-auto flex items-center gap-2 py-1 pl-3 pr-1 text-xs", GLASS)}>
                      <span className="text-muted">
                        {emph.source === "compare" && comparePair
                          ? `Comparing ${byId.get(comparePair[0])?.code ?? ""} and ${byId.get(comparePair[1])?.code ?? ""}; others hollowed out`
                          : emph.source === "focus"
                            ? `Showing ${emph.prominent!.size} of ${drivers.length} drivers`
                            : `All drivers shown`}
                      </span>
                      {comparePair && !comparePanel && (
                        <Button size="sm" variant="secondary" className="h-7 px-2.5 text-xs" onClick={() => setCompareShown(true)}>
                          Open comparison
                        </Button>
                      )}
                      {emph.source === "compare" ? (
                        <Button size="sm" variant="secondary" className="h-7 px-2.5 text-xs" onClick={() => setCompareHighlight(false)}>
                          Show all
                        </Button>
                      ) : emph.source === "focus" ? (
                        <Button size="sm" variant="secondary" className="h-7 px-2.5 text-xs" onClick={() => setFocusSet(null)}>
                          Show all
                        </Button>
                      ) : (
                        comparePair && (
                          <Button size="sm" variant="secondary" className="h-7 px-2.5 text-xs" onClick={() => setCompareHighlight(true)}>
                            Focus {byId.get(comparePair[0])?.code} and {byId.get(comparePair[1])?.code}
                          </Button>
                        )
                      )}
                    </div>
                  </div>
                )}
                <div className="pointer-events-none absolute inset-x-2 bottom-2 flex justify-center sm:inset-x-4 sm:bottom-4">
                  <div className="pointer-events-auto w-full max-w-3xl [&>div]:border-white/10 [&>div]:bg-surface/70 [&>div]:backdrop-blur-xl">{playbackBar}</div>
                </div>
              </div>
    </div>
  );
}

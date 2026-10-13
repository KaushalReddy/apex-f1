"use client";

import dynamic from "next/dynamic";
import { useCallback, useEffect, useId, useMemo, useState, useSyncExternalStore, type ReactNode } from "react";
import { ErrorBoundary } from "@/components/circuit/ErrorBoundary";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Panel } from "@/components/ui/panel";
import type { FlowSettings } from "@/lib/car/airflow";
import { VIEW_LABELS } from "@/lib/car/camera";
import { COMPONENTS, componentInfo } from "@/lib/car/components";
import { CIRCUIT_CONTEXTS, DEFAULT_PROFILE, SETUP_PROFILES, lowDragWings, setupProfile } from "@/lib/car/setup";
import type { SpecStatus } from "@/lib/car/specs";
import { NEUTRAL_LIVERY, type CarDriver } from "@/lib/car/teams";
import type { ComponentId, Livery, SetupProfileId, ViewName } from "@/lib/car/types";
import { cn } from "@/lib/cn";
import { AERO_COLORS, type AeroLayers } from "./Airflow";
import type { CarViewPreset } from "./CarCamera";

// three.js needs window/WebGL: the scene is a lazy, client-only chunk. The server renders the controls and this placeholder.
const CarScene = dynamic(() => import("./CarScene"), {
  ssr: false,
  loading: () => <SceneMessage>Loading 3D car…</SceneMessage>,
});

function SceneMessage({ children }: { children: ReactNode }) {
  return <p className="flex h-full items-center justify-center p-6 text-sm text-muted">{children}</p>;
}

function Unavailable({ reason }: { reason: string }) {
  return (
    <div role="alert" className="flex h-full items-center justify-center p-4">
      <Panel className="max-w-md">
        <p className="font-medium">The 3D car could not start</p>
        <p className="mt-2 text-sm text-muted">
          This usually means WebGL is turned off or unsupported in this browser. The component descriptions and specifications on this page still work.
        </p>
        <p className="mt-3 font-mono text-xs text-subtle">{reason}</p>
      </Panel>
    </div>
  );
}

const subscribeReducedMotion = (cb: () => void) => {
  const mq = window.matchMedia("(prefers-reduced-motion: reduce)");
  mq.addEventListener("change", cb);
  return () => mq.removeEventListener("change", cb);
};
const useReducedMotion = () =>
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
const useWebGL = () => useSyncExternalStore(noSubscribe, detectWebGL, () => null);

/** Toggle button: pressed state uses the design system's red for selected/active. */
function Toggle({ pressed, onClick, children, disabled }: { pressed: boolean; onClick: () => void; children: ReactNode; disabled?: boolean }) {
  return (
    <Button size="sm" variant="secondary" aria-pressed={pressed} disabled={disabled} onClick={onClick} className={cn(pressed && "!border-accent/70 !text-accent-strong")}>
      {children}
    </Button>
  );
}

function ControlGroup({ title, children, className }: { title: string; children: ReactNode; className?: string }) {
  const id = useId();
  return (
    <div role="group" aria-labelledby={id} className={className}>
      <p id={id} className="eyebrow mb-2">
        {title}
      </p>
      {children}
    </div>
  );
}

function Legend({ color, children }: { color: string; children: ReactNode }) {
  return (
    <span className="inline-flex items-center gap-1.5">
      <span aria-hidden="true" className="inline-block size-2.5 shrink-0 rounded-full" style={{ backgroundColor: color }} />
      {children}
    </span>
  );
}

function GradientLegend({ from, via, to, left, right }: { from: string; via: string; to: string; left: string; right: string }) {
  return (
    <div className="text-xs text-muted">
      <span aria-hidden="true" className="block h-1.5 w-full rounded-full" style={{ background: `linear-gradient(90deg, ${from}, ${via}, ${to})` }} />
      <span className="mt-1 flex justify-between gap-2">
        <span>{left}</span>
        <span>{right}</span>
      </span>
    </div>
  );
}

const VIEWS: ViewName[] = ["threeQuarter", "front", "side", "rear", "top"];

const STATUS_LABEL: Record<SpecStatus, { tone: "success" | "info" | "warning" | "neutral"; label: string }> = {
  verified: { tone: "success", label: "Verified" },
  reported: { tone: "info", label: "Reported" },
  conflicting: { tone: "warning", label: "Sources differ" },
  unavailable: { tone: "neutral", label: "Not sourced" },
};

/** One scannable key figure under the showcase. `status` is shown when the value comes from the specification data. */
export interface KeySpec {
  label: string;
  value: string;
  status?: SpecStatus;
}

/** Translucent bar laid over the 3D stage so controls stay close to the car without taking space from it. */
function StageBar({ children, className }: { children: ReactNode; className?: string }) {
  return <div className={cn("flex flex-wrap items-center gap-1.5 rounded-lg border border-line bg-surface/90 p-1.5 shadow-2", className)}>{children}</div>;
}

interface Props {
  teamName: string;
  livery: Livery;
  drivers: CarDriver[];
  keySpecs: readonly KeySpec[];
}

export function CarViewer({ teamName, livery, drivers, keySpecs }: Props) {
  const reducedMotion = useReducedMotion();
  const webgl = useWebGL();

  const [preset, setPreset] = useState<CarViewPreset>({ name: "threeQuarter", nonce: 0 });
  const [autoRotate, setAutoRotate] = useState(false);
  const [exploded, setExploded] = useState(false);
  const [aero, setAero] = useState(false);
  const [aeroPaused, setAeroPaused] = useState<boolean | null>(null); // null: follow the reduced-motion preference
  const [layers, setLayers] = useState<AeroLayers>({ streamlines: true, vortices: true, forces: true });
  const [pressure, setPressure] = useState(false);
  const [lowDrag, setLowDrag] = useState(false);
  const [profileId, setProfileId] = useState<SetupProfileId>(DEFAULT_PROFILE);
  const [circuit, setCircuit] = useState("");
  const [selected, setSelected] = useState<ComponentId | null>(null);
  const [hovered, setHovered] = useState<ComponentId | null>(null);
  const [neutral, setNeutral] = useState(false);
  const [driverSlug, setDriverSlug] = useState(drivers.find((d) => d.number !== undefined)?.slug ?? "");
  const [thumbs, setThumbs] = useState<Partial<Record<ComponentId, string>>>({});

  const profile = setupProfile(profileId);
  const wings = useMemo(() => (lowDrag ? lowDragWings(profile.wings) : profile.wings), [lowDrag, profile.wings]);
  const flow = useMemo<FlowSettings>(() => ({ ...profile.relative, lowDragWings: lowDrag }), [profile.relative, lowDrag]);
  const driver = drivers.find((d) => d.slug === driverSlug);
  const aeroPlaying = aero && !(aeroPaused ?? reducedMotion);
  const context = CIRCUIT_CONTEXTS.find((c) => c.circuitSlug === circuit);
  const info = selected ? componentInfo(selected) : null;

  const goTo = (name: ViewName) => setPreset((p) => ({ name, nonce: p.nonce + 1 }));
  const select = useCallback((id: ComponentId) => setSelected((s) => (s === id ? null : id)), []);
  const hover = useCallback((id: ComponentId | null) => setHovered(id), []);
  const toggleLayer = (k: keyof AeroLayers) => setLayers((l) => ({ ...l, [k]: !l[k] }));

  useEffect(() => {
    document.body.style.cursor = hovered ? "pointer" : "";
    return () => {
      document.body.style.cursor = "";
    };
  }, [hovered]);

  return (
    <div
      onKeyDown={(e) => {
        if (e.key === "Escape" && selected) setSelected(null);
      }}
    >
      {/* Showcase. Height is deliberate, not stretched: on phones the car's framing is width-limited, so the stage follows the screen
          width; on desktop it uses the space left below the sticky header, capped so tall screens do not get an oversized view. */}
      <div className="relative">
        {/* Phones: controls sit above and below the stage. Larger screens: they float over it, close to the car. */}
        <div className="pointer-events-none mb-2 flex flex-wrap items-start justify-between gap-2 sm:absolute sm:inset-x-3 sm:top-3 sm:z-10 sm:mb-0">
          <StageBar className="pointer-events-auto">
            <span className="sr-only">Mode</span>
            <Toggle pressed={exploded} onClick={() => setExploded((x) => !x)}>
              Exploded
            </Toggle>
            <Toggle pressed={aero} onClick={() => setAero((x) => !x)}>
              Aerodynamics
            </Toggle>
            <Toggle pressed={autoRotate && !reducedMotion} disabled={reducedMotion} onClick={() => setAutoRotate((a) => !a)}>
              {reducedMotion ? "Rotate (reduced motion)" : "Rotate"}
            </Toggle>
          </StageBar>
          <div className="flex flex-col items-end gap-1.5">
            {aero && <Badge tone="warning">Illustrative, not a simulation</Badge>}
            {hovered && hovered !== selected && (
              <p aria-hidden="true" className="rounded-md border border-line-strong bg-surface-3/95 px-2 py-1 text-xs font-medium shadow-2">
                {componentInfo(hovered).label}
              </p>
            )}
          </div>
        </div>

      <section
        aria-label={`Interactive 3D model: generic procedural car in ${neutral ? "neutral" : teamName} colours`}
        className="relative h-[clamp(280px,92vw,440px)] overflow-hidden rounded-lg border border-line bg-bg sm:h-[clamp(360px,62vw,520px)] lg:h-[clamp(420px,calc(100svh_-_170px),780px)]"
      >
        {webgl === null ? (
          <SceneMessage>Loading 3D car…</SceneMessage>
        ) : !webgl ? (
          <Unavailable reason="WebGL is not available in this browser." />
        ) : (
          <ErrorBoundary fallback={(e) => <Unavailable reason={e.message} />}>
            <CarScene
              wings={wings}
              livery={neutral ? NEUTRAL_LIVERY : livery}
              number={neutral ? undefined : driver?.number}
              preset={preset}
              selected={selected}
              hovered={hovered}
              exploded={exploded}
              aero={aero}
              aeroPlaying={aeroPlaying}
              aeroLayers={layers}
              pressure={pressure}
              flow={flow}
              autoRotate={autoRotate && !reducedMotion}
              reducedMotion={reducedMotion}
              onSelect={select}
              onHover={hover}
              onThumbnails={setThumbs}
            />
          </ErrorBoundary>
        )}

      </section>
        <div className="pointer-events-none mt-2 flex justify-center sm:absolute sm:inset-x-3 sm:bottom-3 sm:z-10 sm:mt-0">
          <StageBar className="pointer-events-auto justify-center">
            <span className="sr-only">Camera</span>
            {VIEWS.map((v) => (
              <Button key={v} size="sm" variant="ghost" className="h-8 px-2.5" onClick={() => goTo(v)}>
                {VIEW_LABELS[v]}
              </Button>
            ))}
            <Button size="sm" variant="ghost" className="h-8 px-2.5 text-subtle" onClick={() => goTo("threeQuarter")}>
              Reset
            </Button>
          </StageBar>
        </div>
      </div>
      <p className="mt-2 text-xs text-subtle">
        Drag to orbit, right-drag or arrow keys to pan, scroll or pinch to zoom. Tap a part or a card below to inspect it; Escape clears the selection.
        {reducedMotion && " Reduced motion is on: transitions jump and animation starts paused."}
      </p>

      {/* Key figures: scannable, each value labelled with its sourcing status. */}
      <dl
        className="mt-4 grid grid-cols-2 overflow-hidden rounded-lg border border-line bg-line sm:grid-cols-3 lg:grid-cols-5 [&>div:last-child]:col-span-2 lg:[&>div:last-child]:col-span-1"
        style={{ gap: 1 }}
      >
        {keySpecs.map((k) => (
          <div key={k.label} className="bg-surface px-4 py-3">
            <dt className="eyebrow">{k.label}</dt>
            <dd className="mt-1 flex flex-wrap items-center gap-2 text-sm font-medium tabular-nums">
              {k.value}
              {k.status && <Badge tone={STATUS_LABEL[k.status].tone}>{STATUS_LABEL[k.status].label}</Badge>}
            </dd>
          </div>
        ))}
      </dl>

      {/* Component cards: each image is a render of that assembly from the procedural model itself. */}
      <section aria-labelledby="components-heading" className="mt-8">
        <div className="mb-3 flex flex-wrap items-baseline justify-between gap-2">
          <h2 id="components-heading" className="font-display text-2xl font-semibold tracking-[0.01em]">
            Components
          </h2>
          <p className="text-xs text-subtle">Renders of the procedural model&apos;s own assemblies, not photographs of a team&apos;s parts.</p>
        </div>
        <ul className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-5">
          {COMPONENTS.map((c) => (
            <li key={c.id}>
              <button
                type="button"
                aria-pressed={selected === c.id}
                onClick={() => select(c.id)}
                onMouseEnter={() => setHovered(c.id)}
                onMouseLeave={() => setHovered(null)}
                className={cn(
                  "motion-interactive group flex w-full flex-col overflow-hidden rounded-lg border bg-surface text-left",
                  selected === c.id ? "border-accent/70" : "border-line hover:border-line-strong hover:bg-surface-2",
                )}
              >
                <span className="relative block aspect-[16/10] w-full bg-bg">
                  {thumbs[c.id] ? (
                    // eslint-disable-next-line @next/next/no-img-element -- in-memory render (data URL); next/image adds nothing here
                    <img src={thumbs[c.id]} alt="" className="absolute inset-0 h-full w-full object-contain p-1" />
                  ) : (
                    <span aria-hidden="true" className="absolute inset-3 animate-pulse-soft rounded-md bg-surface-2" />
                  )}
                </span>
                <span className={cn("px-3 py-2 text-sm font-medium", selected === c.id ? "text-accent-strong" : "text-fg")}>{c.label}</span>
              </button>
            </li>
          ))}
        </ul>
      </section>

      {/* Three balanced columns: the short Inspector and Livery panels share a column beside Aerodynamics and the setup profile. */}
      <div className="mt-4 grid items-start gap-4 md:grid-cols-2 lg:grid-cols-3">
        <div className="flex flex-col gap-4">
        <Panel className="!p-5">
          <div aria-live="polite">
            {info ? (
              <div>
                <div className="flex items-start justify-between gap-2">
                  <div>
                    <p className="eyebrow">Inspector</p>
                    <h2 className="mt-1 font-display text-2xl font-semibold leading-tight">{info.label}</h2>
                  </div>
                  <Button size="sm" variant="ghost" onClick={() => setSelected(null)}>
                    Clear
                  </Button>
                </div>
                <p className="mt-2 text-sm leading-relaxed text-muted">{info.description}</p>
                <p className="eyebrow mt-4">Aerodynamic role</p>
                <p className="mt-1 text-sm leading-relaxed text-muted">{info.aero}</p>
              </div>
            ) : (
              <div>
                <p className="eyebrow">Inspector</p>
                <p className="mt-2 text-sm text-muted">Select a component card or a part of the car to see what it does and how it affects the airflow.</p>
              </div>
            )}
          </div>
        </Panel>
        <Panel className="!p-5">
          <ControlGroup title="Livery and driver">
            <div className="flex flex-col gap-3 text-sm">
              <label className="flex items-center gap-2">
                <input type="checkbox" checked={neutral} onChange={(e) => setNeutral(e.target.checked)} className="size-4 accent-[var(--color-accent)]" />
                Neutral livery (unbranded base car)
              </label>
              {drivers.length > 0 && (
                <label className="flex flex-col gap-1">
                  <span className="text-muted">Race number</span>
                  <select
                    value={driverSlug}
                    disabled={neutral}
                    onChange={(e) => setDriverSlug(e.target.value)}
                    className="h-9 rounded-md border border-line-strong bg-surface-2 px-2 text-fg disabled:opacity-45"
                  >
                    <option value="">No number</option>
                    {drivers.map((d) => (
                      <option key={d.slug} value={d.slug} disabled={d.number === undefined}>
                        {d.number !== undefined ? `#${d.number} ${d.name}` : `${d.name} (number not sourced)`}
                      </option>
                    ))}
                  </select>
                  <span className="text-xs text-subtle">Adds the race number to the nose and fin only. Every team and driver shares the same body.</span>
                </label>
              )}
            </div>
          </ControlGroup>
        </Panel>
      </div>

        <Panel className="!p-5">
          <ControlGroup title="Aerodynamics">
            {!aero ? (
              <div className="text-sm text-muted">
                <p>Show illustrative airflow, surface pressure, wing-tip vortices and force arrows around the car.</p>
                <Button size="sm" variant="secondary" className="mt-3" onClick={() => setAero(true)}>
                  Turn on aerodynamics
                </Button>
              </div>
            ) : (
              <div className="flex flex-col gap-3">
                <div className="flex flex-wrap gap-2">
                  <Toggle pressed={layers.streamlines} onClick={() => toggleLayer("streamlines")}>
                    Airflow
                  </Toggle>
                  <Toggle pressed={pressure} onClick={() => setPressure((x) => !x)}>
                    Surface pressure
                  </Toggle>
                  <Toggle pressed={layers.vortices} onClick={() => toggleLayer("vortices")}>
                    Vortices
                  </Toggle>
                  <Toggle pressed={layers.forces} onClick={() => toggleLayer("forces")}>
                    Forces
                  </Toggle>
                  <Button size="sm" variant="ghost" onClick={() => setAeroPaused(aeroPlaying)}>
                    {aeroPlaying ? "Pause" : "Play"}
                  </Button>
                </div>
                {exploded && (
                  <p className="text-sm text-warning">
                    Airflow, vortices and forces are modelled around the assembled car, so they are hidden in the exploded view. Surface pressure still shows.
                  </p>
                )}
                <label className="flex items-start gap-2 text-sm">
                  <input type="checkbox" checked={lowDrag} onChange={(e) => setLowDrag(e.target.checked)} className="mt-0.5 size-4 accent-[var(--color-accent)]" />
                  <span>
                    Low-drag wing mode <span className="text-subtle">(conceptual)</span>
                    <span className="block text-xs text-subtle">Flattens the adjustable wing flaps, as on a straight. Not any team&apos;s actual configuration.</span>
                  </span>
                </label>
                {layers.streamlines && (
                  <GradientLegend from={AERO_COLORS.slower} via={AERO_COLORS.free} to={AERO_COLORS.faster} left="Slower than oncoming air" right="Faster" />
                )}
                {pressure && <GradientLegend from={AERO_COLORS.low} via={AERO_COLORS.mid} to={AERO_COLORS.high} left="Lower pressure" right="Higher pressure" />}
                <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted">
                  {layers.vortices && <Legend color={AERO_COLORS.vortex}>Tip vortex</Legend>}
                  {layers.forces && <Legend color={AERO_COLORS.downforce}>Downforce</Legend>}
                  {layers.forces && <Legend color={AERO_COLORS.drag}>Drag</Legend>}
                </div>
                <p className="text-xs leading-relaxed text-subtle">
                  An educational picture, not a computed result: streamlines follow textbook flow around simplified shapes plus the known effects of each
                  device. Arrow lengths are relative to the balanced profile. No pressures, forces or coefficients are measured or shown.
                </p>
              </div>
            )}
          </ControlGroup>
        </Panel>

        <Panel className="!p-5">
          <ControlGroup title="Educational setup profile">
            <div className="flex flex-wrap gap-2">
              {SETUP_PROFILES.map((p) => (
                <Toggle key={p.id} pressed={p.id === profileId} onClick={() => setProfileId(p.id)}>
                  {p.label}
                </Toggle>
              ))}
            </div>
            <p className="mt-2 text-sm text-muted">{profile.summary}</p>
            <label className="mt-3 flex flex-col gap-1 text-sm">
              <span className="text-muted">Circuit context</span>
              <select value={circuit} onChange={(e) => setCircuit(e.target.value)} className="h-9 rounded-md border border-line-strong bg-surface-2 px-2 text-fg">
                <option value="">None</option>
                {CIRCUIT_CONTEXTS.map((c) => (
                  <option key={c.circuitSlug} value={c.circuitSlug}>
                    {c.name}
                  </option>
                ))}
              </select>
            </label>
            {context && (
              <div className="mt-2 text-sm text-muted">
                <p>{context.character}</p>
                {context.illustrates !== profileId && (
                  <Button size="sm" variant="ghost" className="-ml-3.5 mt-1" onClick={() => setProfileId(context.illustrates)}>
                    Show the {setupProfile(context.illustrates).label.toLowerCase()} profile
                  </Button>
                )}
              </div>
            )}
            <p className="mt-2 text-xs text-subtle">Educational presets that change how the wings are drawn and how the illustration behaves. They are not team setups or setup recommendations.</p>
          </ControlGroup>

        </Panel>
      </div>
    </div>
  );
}

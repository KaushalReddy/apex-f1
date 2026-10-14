"use client";

import dynamic from "next/dynamic";
import {
  useCallback,
  useEffect,
  useId,
  useMemo,
  useReducer,
  useRef,
  useState,

  type ReactNode,
} from "react";
import { ErrorBoundary } from "@/components/circuit/ErrorBoundary";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import type { FlowSettings } from "@/lib/car/airflow";
import { VIEW_LABELS } from "@/lib/car/camera";
import { componentInfo } from "@/lib/car/components";
import {
  AERO_FOCUS,
  BALANCE_TEXT,
  DEFAULT_SETUP,
  EVIDENCE_LABEL,
  INITIAL_LAB,
  PART_GROUPS,
  SETUP_PARAMS,
  aeroIndices,
  clampSetup,
  compareSetups,
  effectiveWings,
  groupParts,
  isCompleteCar,
  labReducer,
  matchingPreset,
  partLabel,
  partModes,
  presetSetup,
  type AeroFocus,
  type Evidence,
  type IsolateMode,
  type SetupParams,
} from "@/lib/car/lab";
import { SETUP_PROFILES } from "@/lib/car/setup";
import type { SpecStatus, SpecValue } from "@/lib/car/specs";
import type { ComponentId, Livery, ViewName } from "@/lib/car/types";
import { cn } from "@/lib/cn";
import { useReducedMotion, useWebGL } from "@/lib/use-client-env";
import { useImmersive } from "@/lib/use-immersive";
import { AERO_COLORS, type AeroLayers } from "./Airflow";
import { ImmersiveNav } from "@/components/layout/ImmersiveNav";
import { CfdLab } from "./CfdLab";
import type { FieldName } from "./cfdPaint";
import type { CfdResult } from "@/lib/cfd/model";
import type { CarFocus, CarViewPreset } from "./CarCamera";

const CarScene = dynamic(() => import("./CarScene"), {
  ssr: false,
  loading: () => <StageMessage>Loading 3D car…</StageMessage>,
});

function StageMessage({ children }: { children: ReactNode }) {
  return (
    <p className="flex h-full items-center justify-center p-6 text-sm text-muted">
      {children}
    </p>
  );
}

const STATUS: Record<
  SpecStatus,
  { tone: "success" | "info" | "warning" | "neutral"; label: string }
> = {
  verified: { tone: "success", label: "Verified" },
  reported: { tone: "info", label: "Reported" },
  conflicting: { tone: "warning", label: "Sources differ" },
  unavailable: { tone: "neutral", label: "Not sourced" },
};

function Toggle({
  pressed,
  onClick,
  children,
  disabled,
  label,
}: {
  pressed: boolean;
  onClick: () => void;
  children: ReactNode;
  disabled?: boolean;
  label?: string;
}) {
  return (
    <Button
      size="sm"
      variant="secondary"
      aria-pressed={pressed}
      aria-label={label}
      disabled={disabled}
      onClick={onClick}
      className={cn(
        "h-8 px-2.5",
        pressed && "!border-accent/70 !text-accent-strong",
      )}
    >
      {children}
    </Button>
  );
}

/** Liquid-glass surface for the fullscreen HUD (same treatment as the race view's immersive panels). */
const GLASS =
  "rounded-lg border border-white/10 bg-surface/70 shadow-2 backdrop-blur-xl [box-shadow:inset_0_1px_0_rgb(255_255_255/0.06),var(--shadow-2)] supports-[not(backdrop-filter:blur(1px))]:bg-surface/95";

function Bar({
  children,
  className,
  glass,
}: {
  children: ReactNode;
  className?: string;
  glass?: boolean;
}) {
  return (
    <div
      className={cn(
        "flex flex-wrap items-center gap-1.5 p-1.5",
        glass
          ? GLASS
          : "rounded-lg border border-line bg-surface/90 shadow-2 backdrop-blur-sm",
        className,
      )}
    >
      {children}
    </div>
  );
}

function Section({
  title,
  evidence,
  children,
  className,
}: {
  title: string;
  evidence?: Evidence;
  children: ReactNode;
  className?: string;
}) {
  const id = useId();
  return (
    <section
      aria-labelledby={id}
      className={cn("rounded-lg border border-line bg-surface p-4", className)}
    >
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <h2 id={id} className="eyebrow">
          {title}
        </h2>
        {evidence && (
          <Badge tone={evidence === "sourced" ? "info" : "warning"}>
            {EVIDENCE_LABEL[evidence]}
          </Badge>
        )}
      </div>
      {children}
    </section>
  );
}

type HudTab = "parts" | "inspector" | "aero" | "setup" | "compare" | "cfd";
const HUD_TABS: ReadonlyArray<{ id: HudTab; label: string }> = [
  { id: "parts", label: "Parts" },
  { id: "inspector", label: "Inspector" },
  { id: "aero", label: "Airflow" },
  { id: "setup", label: "Setup" },
  { id: "compare", label: "Compare" },
  { id: "cfd", label: "CFD" },
];

function HudTabs({
  tabs,
  value,
  onChange,
}: {
  tabs: ReadonlyArray<{ id: HudTab; label: string }>;
  value: HudTab;
  onChange: (t: HudTab) => void;
}) {
  return (
    <div
      role="tablist"
      aria-label="Lab panels"
      className="flex shrink-0 gap-1 overflow-x-auto border-b border-white/10 p-1.5"
    >
      {tabs.map((t) => (
        <button
          key={t.id}
          type="button"
          role="tab"
          aria-selected={value === t.id}
          onClick={() => onChange(t.id)}
          className={cn(
            "motion-interactive h-8 shrink-0 rounded-md px-2.5 text-xs font-medium",
            value === t.id
              ? "bg-white/10 text-fg"
              : "text-muted hover:bg-white/5 hover:text-fg",
          )}
        >
          {t.label}
        </button>
      ))}
    </div>
  );
}

const VIEWS: ViewName[] = ["threeQuarter", "front", "side", "rear", "top"];
const signed = (v: number, digits = 0) =>
  `${v > 0 ? "+" : v < 0 ? "−" : "±"}${Math.abs(v).toFixed(digits)}`;

interface Props {
  teamName: string;
  designation: string | null;
  season: number;
  livery: Livery;
  number?: number;
  /** Sourced specification values per component (lib/car/specs.ts); missing entries are shown as not sourced. */
  componentSpecs: Partial<Record<ComponentId, SpecValue[]>>;
  keySpecs: ReadonlyArray<{
    label: string;
    value: string;
    status?: SpecStatus;
  }>;
  /** Where "Exit" goes when there is no earlier page on this site to return to. */
  exitHref: string;
  /** Team picker shown in the top bar (the page owns the list of teams). */
  teamSwitch?: ReactNode;
}

/**
 * The Car Lab: the Phase 4 procedural car with inspection (component tree, selection, hide, isolate, x-ray, explode amount, labels,
 * camera focus), a focused illustrative aerodynamics view, and an A/B wing setup explorer. All inspection and setup state lives in
 * lib/car/lab.ts reducers and functions; this component only wires them to the scene and the controls.
 */
export function CarLab({
  teamName,
  designation,
  season,
  livery,
  number,
  componentSpecs,
  keySpecs,
  exitHref,
  teamSwitch,
}: Props) {
  const reducedMotion = useReducedMotion();
  const webgl = useWebGL();
  const [lab, dispatch] = useReducer(labReducer, INITIAL_LAB);
  const [preset, setPreset] = useState<CarViewPreset>({
    name: "threeQuarter",
    nonce: 0,
  });
  const [focus, setFocus] = useState<CarFocus | null>(null);
  const [hovered, setHovered] = useState<ComponentId | null>(null);
  const [panels, setPanels] = useState({ left: true, right: true });
  // The Lab is full-window only: a fixed layer over the whole tab. Browser fullscreen (which also hides the browser's toolbars) is an
  // optional extra on top of it, since browsers only allow it after a click; it never changes the layout. "Exit" leaves the page.
  const theater = useRef<HTMLDivElement | null>(null);
  const { nativeFs, fsSupported, toggleBrowserFullscreen, leave } = useImmersive(theater, exitHref, () =>
    setPreset((p) => ({ ...p, nonce: p.nonce + 1 })), // the canvas changed size: frame the car again
  );
  const [hudTab, setHudTab] = useState<HudTab>("inspector");
  const [cfdSlice, setCfdSlice] = useState<{
    result: CfdResult;
    field: FieldName;
  } | null>(null);
  const showCfd = useCallback(
    (result: CfdResult | null, field: FieldName) =>
      setCfdSlice(result ? { result, field } : null),
    [],
  );
  const [sheet, setSheet] = useState<HudTab | null>(null);
  const [autoRotate, setAutoRotate] = useState(false);

  const [aero, setAero] = useState(false);
  const [aeroFocus, setAeroFocus] = useState<AeroFocus>("overall");
  const [layers, setLayers] = useState<AeroLayers>({
    streamlines: true,
    vortices: true,
    forces: true,
  });
  const [pressure, setPressure] = useState(false);
  const [aeroPaused, setAeroPaused] = useState<boolean | null>(null);

  const [setups, setSetups] = useState<{
    a: SetupParams;
    b: SetupParams;
    active: "a" | "b";
  }>({ a: DEFAULT_SETUP, b: presetSetup("low-drag"), active: "a" });
  const active = setups[setups.active];
  const wings = useMemo(() => effectiveWings(active), [active]);
  const indices = aeroIndices(active);
  // The indices already include the low-drag mode (via the drawn wing angles), so the flow is not weakened a second time.
  const flow = useMemo<FlowSettings>(
    () => ({
      downforce: indices.downforce,
      drag: indices.drag,
      lowDragWings: false,
    }),
    [indices.downforce, indices.drag],
  );
  const comparison = compareSetups(setups.a, setups.b);
  const modes = useMemo(() => partModes(lab), [lab]);
  const aeroPlaying = aero && !(aeroPaused ?? reducedMotion);
  const info = lab.selected ? componentInfo(lab.selected) : null;
  const specs = lab.selected ? (componentSpecs[lab.selected] ?? []) : [];
  const complete = isCompleteCar(lab);

  const select = useCallback(
    (id: ComponentId) => dispatch({ type: "toggleSelect", id }),
    [],
  );
  const hover = useCallback((id: ComponentId | null) => setHovered(id), []);
  const goTo = (name: ViewName) =>
    setPreset((p) => ({ name, nonce: p.nonce + 1 }));
  const focusOn = (id: ComponentId) =>
    setFocus((f) => ({ id, nonce: (f?.nonce ?? 0) + 1 }));
  const resetScene = () => {
    dispatch({ type: "reset" });
    setAero(false);
    setAeroFocus("overall");
    goTo("threeQuarter");
  };
  const editActive = (patch: Partial<SetupParams>) =>
    setSetups((s) => ({
      ...s,
      [s.active]: clampSetup({ ...s[s.active], ...patch }),
    }));


  // Escape clears the selection wherever focus is (including after the focused control disappears).
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") dispatch({ type: "select", id: null });
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);


  useEffect(() => {
    document.body.style.cursor = hovered ? "pointer" : "";
    return () => {
      document.body.style.cursor = "";
    };
  }, [hovered]);

  const tree = (
    <ComponentTree
      lab={lab}
      dispatch={dispatch}
      complete={complete}
      onHover={hover}
    />
  );
  const inspectorPanel = (
    <Section title="Inspector">
      <div aria-live="polite">
        {info ? (
          <div>
            <div className="flex items-start justify-between gap-2">
              <h3 className="font-display text-2xl font-semibold leading-tight">
                {info.label}
              </h3>
              <Badge tone="accent">Selected</Badge>
            </div>
            <p className="eyebrow mt-3">What it is</p>
            <p className="mt-1 text-sm leading-relaxed text-muted">
              {info.description}
            </p>
            <p className="eyebrow mt-3">Aerodynamic role · educational</p>
            <p className="mt-1 text-sm leading-relaxed text-muted">
              {info.aero}
            </p>
            <div className="mt-3 flex flex-wrap gap-2">
              <Button
                size="sm"
                variant="secondary"
                onClick={() => focusOn(info.id)}
              >
                Focus camera
              </Button>
              <Button
                size="sm"
                variant="secondary"
                onClick={() => {
                  dispatch({
                    type: "setPartsHidden",
                    keys: groupPartsOf(info.id),
                    hidden: true,
                  });
                  dispatch({ type: "select", id: null });
                }}
              >
                Hide
              </Button>
              <Button
                size="sm"
                variant="ghost"
                onClick={() => dispatch({ type: "select", id: null })}
              >
                Clear
              </Button>
            </div>
            <fieldset className="mt-3">
              <legend className="eyebrow mb-1.5">Isolate</legend>
              <div className="flex flex-wrap gap-1.5">
                {(
                  [
                    ["off", "Off"],
                    ["ghost", "Fade the rest"],
                    ["solo", "Hide the rest"],
                  ] as Array<[IsolateMode, string]>
                ).map(([m, label]) => (
                  <Toggle
                    key={m}
                    pressed={lab.isolate === m}
                    onClick={() => dispatch({ type: "isolate", mode: m })}
                  >
                    {label}
                  </Toggle>
                ))}
              </div>
            </fieldset>
            <p className="eyebrow mt-4">
              Specifications · {designation ?? teamName} ({season})
            </p>
            {specs.length ? (
              <dl className="mt-1 space-y-1 text-sm">
                {specs.map((v) => (
                  <div
                    key={v.label}
                    className="flex flex-wrap items-center justify-between gap-2"
                  >
                    <dt className="text-muted">{v.label}</dt>
                    <dd className="flex items-center gap-2">
                      {v.value ?? "Not available"}
                      {v.unit && v.value ? ` ${v.unit}` : ""}
                      <Badge tone={STATUS[v.status].tone}>
                        {STATUS[v.status].label}
                      </Badge>
                    </dd>
                  </div>
                ))}
              </dl>
            ) : (
              <p className="mt-1 text-sm text-muted">
                Not available. No sourced dimensions, mass, materials or
                performance figures for this component, so none are shown. The
                model is generic and not measured from {teamName}&apos;s car.
              </p>
            )}
          </div>
        ) : (
          <div className="text-sm text-muted">
            <p>
              Select a component in the 3D view or the list to inspect, focus,
              hide or isolate it.
            </p>
            <dl className="mt-3 space-y-1.5">
              {keySpecs.map((k) => (
                <div
                  key={k.label}
                  className="flex flex-wrap items-center justify-between gap-2"
                >
                  <dt className="text-subtle">{k.label}</dt>
                  <dd className="flex items-center gap-2 text-fg">
                    {k.value}
                    {k.status && (
                      <Badge tone={STATUS[k.status].tone}>
                        {STATUS[k.status].label}
                      </Badge>
                    )}
                  </dd>
                </div>
              ))}
            </dl>
          </div>
        )}
      </div>
    </Section>
  );
  const aeroPanel = (
    <AeroPanel
      aero={aero}
      setAero={setAero}
      focus={aeroFocus}
      setFocus={setAeroFocus}
      layers={layers}
      setLayers={setLayers}
      pressure={pressure}
      setPressure={setPressure}
      playing={aeroPlaying}
      togglePlay={() => setAeroPaused(aeroPlaying)}
      exploded={lab.explode > 0}
    />
  );
  const setupPanel = (
    <Section title="Setup explorer" evidence="simplified-model">
      <div
        role="radiogroup"
        aria-label="Configuration shown in 3D and edited"
        className="mb-3 grid grid-cols-2 gap-1.5"
      >
        {(["a", "b"] as const).map((k) => (
          <button
            key={k}
            type="button"
            role="radio"
            aria-checked={setups.active === k}
            onClick={() => setSetups((s) => ({ ...s, active: k }))}
            className={cn(
              "motion-interactive rounded-md border px-3 py-2 text-left text-sm",
              setups.active === k
                ? "border-accent/70 bg-surface-2 text-fg"
                : "border-line text-muted hover:border-line-strong hover:text-fg",
            )}
          >
            <span className="font-semibold">Config {k.toUpperCase()}</span>
            <span className="block text-xs text-subtle">
              {matchingPreset(setups[k])
                ? SETUP_PROFILES.find(
                    (p) => p.id === matchingPreset(setups[k]),
                  )!.label
                : "Custom"}
              {setups[k].lowDrag ? " · low-drag mode" : ""}
              {setups.active === k ? " · shown" : ""}
            </span>
          </button>
        ))}
      </div>
      <div className="flex flex-wrap gap-1.5">
        {SETUP_PROFILES.map((p) => (
          <Toggle
            key={p.id}
            pressed={matchingPreset(active) === p.id}
            onClick={() => editActive({ ...presetSetup(p.id) })}
          >
            {p.label}
          </Toggle>
        ))}
      </div>
      <div className="mt-3 space-y-3">
        {SETUP_PARAMS.map((m) => (
          <label key={m.key} className="block text-sm">
            <span className="flex justify-between gap-2">
              <span className="text-muted">{m.label}</span>
              <span className="tabular-nums text-fg">
                {active[m.key]}
                {m.unit}
                {active.lowDrag && wings[m.key] !== active[m.key] && (
                  <span className="text-subtle">
                    {" "}
                    (drawn {wings[m.key]}
                    {m.unit})
                  </span>
                )}
              </span>
            </span>
            <input
              type="range"
              min={m.min}
              max={m.max}
              step={m.step}
              value={active[m.key]}
              onChange={(e) => editActive({ [m.key]: Number(e.target.value) })}
              aria-valuetext={`${active[m.key]} degrees`}
              className="mt-1 w-full accent-[var(--color-accent)]"
            />
            <span className="mt-0.5 block text-xs text-subtle">
              {m.min}–{m.max}
              {m.unit}, default {DEFAULT_SETUP[m.key]}
              {m.unit}. {m.effect}
            </span>
          </label>
        ))}
        <label className="flex items-start gap-2 text-sm">
          <input
            type="checkbox"
            checked={active.lowDrag}
            onChange={(e) => editActive({ lowDrag: e.target.checked })}
            className="mt-0.5 size-4 accent-[var(--color-accent)]"
          />
          <span>
            Low-drag wing mode <span className="text-subtle">(conceptual)</span>
            <span className="block text-xs text-subtle">
              Flattens the adjustable flaps, as on a straight. Not any
              team&apos;s or the regulations&apos; actual values.
            </span>
          </span>
        </label>
      </div>
      <dl className="mt-3 grid grid-cols-2 gap-2 border-t border-line pt-3 text-sm tabular-nums">
        <div>
          <dt className="text-xs text-subtle">Downforce index</dt>
          <dd className="font-display text-2xl font-semibold">
            {indices.downforce.toFixed(2)}
          </dd>
        </div>
        <div>
          <dt className="text-xs text-subtle">Drag index</dt>
          <dd className="font-display text-2xl font-semibold">
            {indices.drag.toFixed(2)}
          </dd>
        </div>
      </dl>
      <p className="mt-1 text-xs text-muted">{BALANCE_TEXT[indices.balance]}</p>
      <div className="mt-3 flex flex-wrap gap-2">
        <Button
          size="sm"
          variant="ghost"
          onClick={() =>
            setSetups((s) => ({ ...s, [s.active]: DEFAULT_SETUP }))
          }
        >
          Reset Config {setups.active.toUpperCase()}
        </Button>
        <Button
          size="sm"
          variant="ghost"
          onClick={() =>
            setSetups((s) => ({
              ...s,
              [s.active === "a" ? "b" : "a"]: s[s.active],
            }))
          }
        >
          Copy to Config {setups.active === "a" ? "B" : "A"}
        </Button>
      </div>
    </Section>
  );
  const comparePanel = <ComparePanel comparison={comparison} />;
  const cfdPanel = (
    <CfdLab setups={{ a: setups.a, b: setups.b }} onShowInCar={showCfd} />
  );

  return (
    <div ref={theater} className="fixed inset-0 z-[70] bg-bg">
      <ImmersiveNav
        actions={
          <>
            {fsSupported && (
              <span className="hidden sm:contents">
                <Button
                  size="sm"
                  variant="ghost"
                  className="h-8 px-2"
                  aria-pressed={nativeFs}
                  onClick={() => void toggleBrowserFullscreen(!nativeFs)}
                  title={nativeFs ? "Leave browser fullscreen (the Lab stays full-window)" : "Hide the browser's toolbars too"}
                >
                  {nativeFs ? "Exit browser fullscreen" : "Browser fullscreen"}
                </Button>
              </span>
            )}
            <Button size="sm" variant="secondary" className="h-8 px-2.5" onClick={leave} title="Leave the Car Lab">
              Exit
            </Button>
          </>
        }
      />
      <div className="pointer-events-none absolute inset-x-2 top-14 z-20 flex flex-wrap items-start justify-between gap-2 sm:inset-x-4 sm:top-16">
        <Bar glass className="pointer-events-auto">
          <h1 className="px-2 font-display text-lg font-semibold leading-none">
            {teamName} Car Lab
          </h1>
          {teamSwitch && (
            <span className="hidden md:contents">{teamSwitch}</span>
          )}
          <label className="flex items-center gap-2 px-1.5 text-xs text-muted">
            <span>Explode</span>
            <input
              type="range"
              min={0}
              max={100}
              step={5}
              value={Math.round(lab.explode * 100)}
              onChange={(e) =>
                dispatch({
                  type: "explode",
                  amount: Number(e.target.value) / 100,
                })
              }
              aria-valuetext={`${Math.round(lab.explode * 100)}% exploded`}
              className="w-24 accent-[var(--color-accent)]"
            />
          </label>
          <Toggle
            pressed={lab.xray}
            onClick={() => dispatch({ type: "xray", on: !lab.xray })}
          >
            X-ray
          </Toggle>
          <Toggle
            pressed={lab.labels}
            onClick={() => dispatch({ type: "labels", on: !lab.labels })}
          >
            Labels
          </Toggle>
          <Toggle pressed={aero} onClick={() => setAero((x) => !x)}>
            Airflow
          </Toggle>
          <Toggle
            pressed={autoRotate && !reducedMotion}
            disabled={reducedMotion}
            onClick={() => setAutoRotate((x) => !x)}
          >
            Rotate
          </Toggle>
        </Bar>
        <div className="pointer-events-auto flex flex-col items-end gap-1.5">
          {cfdSlice && (
            <Badge tone="info">
              SU2 result · 2D section at z = {cfdSlice.result.transform?.z} m
            </Badge>
          )}
          {aero && !cfdSlice && (
            <Badge tone="warning">Conceptual airflow, not CFD</Badge>
          )}
          {!complete && (
            <Bar glass>
              <span className="px-1 text-xs text-muted">
                {lab.isolate !== "off" && info
                  ? `Isolated: ${info.label}`
                  : lab.hidden.length
                    ? `${lab.hidden.length} part${lab.hidden.length === 1 ? "" : "s"} hidden`
                    : lab.xray
                      ? "X-ray on"
                      : "Exploded"}
              </span>
              <Button
                size="sm"
                variant="ghost"
                className="h-7 px-2"
                onClick={() => {
                  dispatch({ type: "restoreCar" });
                  dispatch({ type: "explode", amount: 0 });
                }}
              >
                Restore car
              </Button>
            </Bar>
          )}
          {hovered && hovered !== lab.selected && (
            <p
              aria-hidden="true"
              className="rounded-md border border-line-strong bg-surface-3/95 px-2 py-1 text-xs font-medium shadow-2"
            >
              {componentInfo(hovered).label}
            </p>
          )}
        </div>
      </div>

      <section
        aria-label={`Car Lab 3D view: generic procedural car in ${teamName} colours${info ? `, ${info.label} selected` : ""}`}
        className={cn(
          "absolute inset-0 overflow-hidden bg-bg",
          // Phone sheet open: the car keeps the top half, above the sheet. Large screens: the car sits between the side panels.
          sheet && "max-lg:bottom-[50svh]",
          panels.left && "lg:left-[18rem]",
          panels.right &&
            "lg:right-[23rem]",
        )}
      >
        {webgl === null ? (
          <StageMessage>Loading 3D car…</StageMessage>
        ) : !webgl ? (
          <div
            role="alert"
            className="flex h-full items-center justify-center p-6 text-center text-sm text-muted"
          >
            WebGL is not available in this browser, so the 3D car cannot be
            drawn. The component information, setup, comparison and CFD panels
            still work.
          </div>
        ) : (
          <ErrorBoundary
            fallback={(e) => (
              <div
                role="alert"
                className="flex h-full items-center justify-center p-6 text-center text-sm text-muted"
              >
                The 3D car could not start ({e.message}). The panels still work.
              </div>
            )}
          >
            <CarScene
              wings={wings}
              livery={livery}
              number={number}
              preset={preset}
              selected={lab.selected}
              hovered={hovered}
              exploded={lab.explode > 0}
              explode={lab.explode}
              modes={modes}
              annotate={lab.labels}
              focus={focus}
              aero={aero}
              aeroPlaying={aeroPlaying}
              aeroLayers={layers}
              aeroFocus={aeroFocus}
              cfdSlice={cfdSlice}
              pressure={pressure}
              flow={flow}
              autoRotate={autoRotate && !reducedMotion}
              reducedMotion={reducedMotion}
              onSelect={select}
              onHover={hover}
            />
          </ErrorBoundary>
        )}
      </section>

      <div className="pointer-events-none absolute inset-x-2 bottom-2 z-20 flex flex-wrap items-end justify-between gap-2 sm:inset-x-4 sm:bottom-4">
        <Bar
          glass
          className={cn("pointer-events-auto", sheet && "max-lg:hidden")}
        >
          <span className="sr-only">Camera</span>
          {VIEWS.map((v) => (
            <Button
              key={v}
              size="sm"
              variant="ghost"
              className="h-8 px-2"
              onClick={() => goTo(v)}
            >
              {VIEW_LABELS[v]}
            </Button>
          ))}
          <Button
            size="sm"
            variant="ghost"
            className="h-8 px-2"
            onClick={() => goTo(preset.name)}
            title="Re-frame the whole car in the current view"
          >
            Fit
          </Button>
          <Button
            size="sm"
            variant="ghost"
            className="h-8 px-2"
            disabled={!lab.selected}
            onClick={() => lab.selected && focusOn(lab.selected)}
          >
            Focus part
          </Button>
        </Bar>
        <Bar glass className="pointer-events-auto">
          {/* Large screens: side panels beside the car, each can be hidden. Smaller: one bottom sheet ("Panels"). */}
          <span className="hidden lg:contents">
            <Button
              size="sm"
              variant="ghost"
              className="h-8 px-2"
              aria-expanded={panels.left}
              onClick={() => setPanels((p) => ({ ...p, left: !p.left }))}
            >
              {panels.left ? "Hide parts" : "Parts"}
            </Button>
            <Button
              size="sm"
              variant="ghost"
              className="h-8 px-2"
              aria-expanded={panels.right}
              onClick={() => setPanels((p) => ({ ...p, right: !p.right }))}
            >
              {panels.right ? "Hide info" : "Info"}
            </Button>
          </span>
          <span className="contents lg:hidden">
            <Button
              size="sm"
              variant="ghost"
              className="h-8 px-2"
              aria-expanded={sheet !== null}
              onClick={() => setSheet((x) => (x ? null : hudTab))}
            >
              {sheet ? "Hide panel" : "Panels"}
            </Button>
          </span>
          <Button
            size="sm"
            variant="ghost"
            className="h-8 px-2 text-subtle"
            onClick={resetScene}
          >
            Reset scene
          </Button>
        </Bar>
      </div>

      {/* Glass panels. Large screens: parts on the left, a tabbed panel on the right, beside the car. Smaller: one bottom sheet. */}
      <>
        {panels.left && (
          <div
            className={cn(
              "absolute bottom-[4.75rem] left-4 top-[8rem] z-10 hidden w-[16.5rem] overflow-y-auto lg:block",
              GLASS,
            )}
          >
            {tree}
          </div>
        )}
        {panels.right && (
          <div
            className={cn(
              "absolute bottom-[4.75rem] right-4 top-[8rem] z-10 hidden flex-col overflow-hidden lg:flex",
              "w-[21.5rem]",
              GLASS,
            )}
          >
            <HudTabs
              tabs={HUD_TABS.filter((t) => t.id !== "parts")}
              value={hudTab === "parts" ? "inspector" : hudTab}
              onChange={setHudTab}
            />
            <div className="min-h-0 flex-1 overflow-y-auto [&>section]:rounded-none [&>section]:border-0 [&>section]:bg-transparent">
              {
                {
                  parts: null,
                  inspector: inspectorPanel,
                  aero: aeroPanel,
                  setup: setupPanel,
                  compare: comparePanel,
                  cfd: cfdPanel,
                }[hudTab === "parts" ? "inspector" : hudTab]
              }
            </div>
          </div>
        )}
        {sheet && (
          <div
            className={cn(
              "absolute inset-x-2 bottom-[3.75rem] top-[50svh] z-10 flex flex-col overflow-hidden sm:inset-x-4 sm:bottom-[4.5rem] lg:hidden",
              GLASS,
            )}
          >
            <HudTabs
              tabs={HUD_TABS}
              value={sheet}
              onChange={(t) => {
                setSheet(t);
                setHudTab(t);
              }}
            />
            <div className="min-h-0 flex-1 overflow-y-auto [&>section]:rounded-none [&>section]:border-0 [&>section]:bg-transparent">
              {
                {
                  parts: tree,
                  inspector: inspectorPanel,
                  aero: aeroPanel,
                  setup: setupPanel,
                  compare: comparePanel,
                  cfd: cfdPanel,
                }[sheet]
              }
            </div>
          </div>
        )}
      </>
    </div>
  );
}

/** Every part of a component (wheels: all four). */
const groupPartsOf = (id: ComponentId) =>
  PART_GROUPS.flatMap((g) =>
    g.components.filter((c) => c.id === id).flatMap((c) => c.parts),
  );

function ComponentTree({
  lab,
  dispatch,
  complete,
  onHover,
}: {
  lab: ReturnType<typeof labReducer>;
  dispatch: (a: Parameters<typeof labReducer>[1]) => void;
  complete: boolean;
  onHover: (id: ComponentId | null) => void;
}) {
  return (
    <div className="p-3">
      <div className="mb-2 flex items-center justify-between gap-2 px-1">
        <h2 className="eyebrow">Components</h2>
        <Button
          size="sm"
          variant="ghost"
          className="h-7 px-2"
          disabled={complete}
          onClick={() => dispatch({ type: "restoreCar" })}
        >
          Show all
        </Button>
      </div>
      <ul className="space-y-3">
        {PART_GROUPS.map((g) => {
          const parts = groupParts(g);
          const allHidden = parts.every((k) => lab.hidden.includes(k));
          return (
            <li key={g.id}>
              <div className="flex items-center justify-between gap-2 px-1">
                <h3 className="text-[11px] font-semibold uppercase tracking-wider text-subtle">
                  {g.label}
                </h3>
                <button
                  type="button"
                  className="text-[11px] text-muted underline-offset-4 hover:text-fg hover:underline"
                  aria-label={`${allHidden ? "Show" : "Hide"} ${g.label}`}
                  onClick={() =>
                    dispatch({
                      type: "setPartsHidden",
                      keys: parts,
                      hidden: !allHidden,
                    })
                  }
                >
                  {allHidden ? "Show" : "Hide"}
                </button>
              </div>
              <ul className="mt-1 space-y-0.5">
                {g.components.map((c) => {
                  const selected = lab.selected === c.id;
                  const label =
                    c.parts.length === 1
                      ? partLabel(c.parts[0])
                      : componentInfo(c.id).label +
                        (c.id === "wheels" ? ` (${g.id})` : "");
                  return (
                    <li key={`${g.id}-${c.id}`}>
                      <div
                        className={cn(
                          "flex items-center gap-1 rounded-md",
                          selected && "bg-surface-2",
                        )}
                      >
                        <button
                          type="button"
                          aria-pressed={selected}
                          onClick={() =>
                            dispatch({ type: "toggleSelect", id: c.id })
                          }
                          onMouseEnter={() => onHover(c.id)}
                          onMouseLeave={() => onHover(null)}
                          className={cn(
                            "motion-interactive flex min-h-8 flex-1 items-center gap-2 rounded-md px-2 py-1 text-left text-sm",
                            selected
                              ? "font-semibold text-accent-strong"
                              : "text-fg hover:bg-surface-2",
                          )}
                        >
                          <span
                            aria-hidden="true"
                            className={cn(
                              "size-1.5 shrink-0 rounded-full",
                              selected ? "bg-accent" : "bg-line-strong",
                            )}
                          />
                          {label}
                          {selected && (
                            <span className="sr-only">(selected)</span>
                          )}
                        </button>
                        {c.parts.length === 1 && (
                          <Visibility
                            partKey={c.parts[0]}
                            label={label}
                            lab={lab}
                            dispatch={dispatch}
                          />
                        )}
                      </div>
                      {c.parts.length > 1 && (
                        <ul className="ml-5 mt-0.5 space-y-0.5">
                          {c.parts.map((k) => (
                            <li
                              key={k}
                              className="flex items-center justify-between gap-2 pl-2 text-xs text-muted"
                            >
                              {partLabel(k)}
                              <Visibility
                                partKey={k}
                                label={partLabel(k)}
                                lab={lab}
                                dispatch={dispatch}
                              />
                            </li>
                          ))}
                        </ul>
                      )}
                    </li>
                  );
                })}
              </ul>
            </li>
          );
        })}
      </ul>
    </div>
  );
}

function Visibility({
  partKey,
  label,
  lab,
  dispatch,
}: {
  partKey: string;
  label: string;
  lab: ReturnType<typeof labReducer>;
  dispatch: (a: Parameters<typeof labReducer>[1]) => void;
}) {
  const hidden = lab.hidden.includes(partKey);
  return (
    <label className="flex shrink-0 cursor-pointer items-center gap-1 px-1.5 py-1 text-[11px] text-subtle">
      <input
        type="checkbox"
        checked={!hidden}
        onChange={(e) =>
          dispatch({
            type: "setPartHidden",
            key: partKey,
            hidden: !e.target.checked,
          })
        }
        aria-label={`Show ${label}`}
        className="size-3.5 accent-[var(--color-accent)]"
      />
      {hidden && <span aria-hidden="true">Hidden</span>}
    </label>
  );
}

function Legend({ color, children }: { color: string; children: ReactNode }) {
  return (
    <span className="inline-flex items-center gap-1.5">
      <span
        aria-hidden="true"
        className="inline-block size-2.5 shrink-0 rounded-full"
        style={{ backgroundColor: color }}
      />
      {children}
    </span>
  );
}

function Gradient({
  from,
  via,
  to,
  left,
  right,
}: {
  from: string;
  via: string;
  to: string;
  left: string;
  right: string;
}) {
  return (
    <div className="text-xs text-muted">
      <span
        aria-hidden="true"
        className="block h-1.5 w-full rounded-full"
        style={{ background: `linear-gradient(90deg, ${from}, ${via}, ${to})` }}
      />
      <span className="mt-1 flex justify-between gap-2">
        <span>{left}</span>
        <span>{right}</span>
      </span>
    </div>
  );
}

function AeroPanel(p: {
  aero: boolean;
  setAero: (on: boolean) => void;
  focus: AeroFocus;
  setFocus: (f: AeroFocus) => void;
  layers: AeroLayers;
  setLayers: (f: (l: AeroLayers) => AeroLayers) => void;
  pressure: boolean;
  setPressure: (f: (x: boolean) => boolean) => void;
  playing: boolean;
  togglePlay: () => void;
  exploded: boolean;
}) {
  const focus = AERO_FOCUS.find((f) => f.id === p.focus)!;
  return (
    <Section title="Aerodynamics" evidence="conceptual">
      <div className="flex flex-wrap gap-1.5">
        <Toggle pressed={p.aero} onClick={() => p.setAero(!p.aero)}>
          {p.aero ? "Airflow on" : "Show airflow"}
        </Toggle>
        {p.aero && (
          <Button
            size="sm"
            variant="ghost"
            className="h-8 px-2.5"
            onClick={p.togglePlay}
          >
            {p.playing ? "Pause" : "Play"}
          </Button>
        )}
      </div>
      <div
        role="radiogroup"
        aria-label="Airflow focus"
        className="mt-3 flex flex-wrap gap-1.5"
      >
        {AERO_FOCUS.map((f) => (
          <button
            key={f.id}
            type="button"
            role="radio"
            aria-checked={p.focus === f.id}
            disabled={!p.aero}
            onClick={() => p.setFocus(f.id)}
            className={cn(
              "motion-interactive h-8 rounded-md border px-2.5 text-xs font-medium disabled:opacity-45",
              p.focus === f.id
                ? "border-accent/70 bg-surface-2 text-fg"
                : "border-line text-muted hover:border-line-strong hover:text-fg",
            )}
          >
            {f.label}
          </button>
        ))}
      </div>
      {focus.components.length > 0 && (
        <p className="mt-2 text-sm text-muted">
          {focus.components.map((c) => componentInfo(c).aero).join(" ")}
        </p>
      )}
      <div className="mt-3 flex flex-wrap gap-1.5">
        <Toggle
          disabled={!p.aero}
          pressed={p.layers.streamlines}
          onClick={() =>
            p.setLayers((l) => ({ ...l, streamlines: !l.streamlines }))
          }
        >
          Streamlines
        </Toggle>
        <Toggle
          disabled={!p.aero}
          pressed={p.layers.vortices}
          onClick={() => p.setLayers((l) => ({ ...l, vortices: !l.vortices }))}
        >
          Vortices
        </Toggle>
        <Toggle
          disabled={!p.aero}
          pressed={p.layers.forces}
          onClick={() => p.setLayers((l) => ({ ...l, forces: !l.forces }))}
        >
          Force arrows
        </Toggle>
        <Toggle
          disabled={!p.aero}
          pressed={p.pressure}
          onClick={() => p.setPressure((x) => !x)}
        >
          Surface pressure
        </Toggle>
      </div>
      {p.aero && p.exploded && (
        <p className="mt-2 text-sm text-warning">
          Airflow is modelled around the assembled car, so it is hidden while
          the car is exploded.
        </p>
      )}
      {p.aero && (
        <div className="mt-3 space-y-2">
          {p.layers.streamlines && (
            <Gradient
              from={AERO_COLORS.slower}
              via={AERO_COLORS.free}
              to={AERO_COLORS.faster}
              left="Slower than oncoming air"
              right="Faster"
            />
          )}
          {p.pressure && (
            <Gradient
              from={AERO_COLORS.low}
              via={AERO_COLORS.mid}
              to={AERO_COLORS.high}
              left="Lower pressure"
              right="Higher pressure"
            />
          )}
          <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted">
            {p.layers.vortices && (
              <Legend color={AERO_COLORS.vortex}>Tip vortex</Legend>
            )}
            {p.layers.forces && (
              <Legend color={AERO_COLORS.downforce}>
                Downforce (relative)
              </Legend>
            )}
            {p.layers.forces && (
              <Legend color={AERO_COLORS.drag}>Drag (relative)</Legend>
            )}
          </div>
        </div>
      )}
      <p className="mt-3 text-xs leading-relaxed text-subtle">
        Streamlines follow textbook flow around simplified shapes plus the known
        effect of each device; they are not computed from this car&apos;s
        surfaces. Pressure colours are illustrative. Arrow lengths use the
        setup&apos;s downforce and drag indices (balanced = 1). No forces,
        pressures or coefficients are measured.
      </p>
    </Section>
  );
}

function ComparePanel({
  comparison: c,
}: {
  comparison: ReturnType<typeof compareSetups>;
}) {
  const bar = (v: number) => (
    <span aria-hidden="true" className="block h-1.5 rounded-full bg-line">
      <span
        className="block h-full rounded-full bg-fg/70"
        style={{ width: `${Math.min(100, (v / 1.6) * 100)}%` }}
      />
    </span>
  );
  return (
    <Section title="Compare configurations" evidence="simplified-model">
      {c.identical ? (
        <p className="text-sm text-muted">
          Config A and B are identical. Change either one to compare.
        </p>
      ) : (
        <>
          <table className="w-full text-sm tabular-nums">
            <caption className="sr-only">Config B relative to Config A</caption>
            <thead className="text-[11px] uppercase tracking-wider text-subtle">
              <tr>
                <th scope="col" className="py-1 text-left font-medium">
                  Parameter
                </th>
                <th scope="col" className="py-1 text-right font-medium">
                  A
                </th>
                <th scope="col" className="py-1 text-right font-medium">
                  B
                </th>
                <th scope="col" className="py-1 text-right font-medium">
                  B − A
                </th>
              </tr>
            </thead>
            <tbody className="divide-y divide-line">
              {c.params.map((p) => (
                <tr key={p.key}>
                  <th
                    scope="row"
                    className="py-1 text-left font-normal text-muted"
                  >
                    {p.label}
                  </th>
                  <td className="py-1 text-right">{p.a}°</td>
                  <td className="py-1 text-right">{p.b}°</td>
                  <td
                    className={cn(
                      "py-1 text-right",
                      p.delta === 0 ? "text-subtle" : "text-fg",
                    )}
                  >
                    {signed(p.delta)}°
                  </td>
                </tr>
              ))}
              <tr>
                <th
                  scope="row"
                  className="py-1 text-left font-normal text-muted"
                >
                  Low-drag mode
                </th>
                <td className="py-1 text-right">
                  {c.lowDrag.a ? "On" : "Off"}
                </td>
                <td className="py-1 text-right">
                  {c.lowDrag.b ? "On" : "Off"}
                </td>
                <td className="py-1 text-right text-subtle">
                  {c.lowDrag.a === c.lowDrag.b ? "same" : "differs"}
                </td>
              </tr>
            </tbody>
          </table>
          <dl className="mt-3 space-y-2 text-sm tabular-nums">
            {c.indices.map((i) => (
              <div key={i.key}>
                <dt className="flex justify-between gap-2 text-muted">
                  <span>{i.label}</span>
                  <span className="text-fg">
                    {i.a.toFixed(2)} → {i.b.toFixed(2)}{" "}
                    <span className="text-subtle">({signed(i.delta, 2)})</span>
                  </span>
                </dt>
                <dd className="mt-1 grid grid-cols-[1.25rem_1fr] items-center gap-x-2 gap-y-1 text-[11px] text-subtle">
                  <span>A</span>
                  {bar(i.a)}
                  <span>B</span>
                  {bar(i.b)}
                </dd>
              </div>
            ))}
          </dl>
          <p className="mt-2 text-xs text-muted">
            Balance: A {c.balance.a}, B {c.balance.b}
            {c.balance.a !== c.balance.b && ` · ${BALANCE_TEXT[c.balance.b]}`}
          </p>
        </>
      )}
      <details className="mt-3 text-xs text-subtle">
        <summary className="cursor-pointer text-muted hover:text-fg">
          Model and assumptions
        </summary>
        <ul className="mt-2 list-disc space-y-1 pl-4 leading-relaxed">
          <li>
            Only the wing angles are adjustable: they are the only setup values
            the procedural model implements (they reshape the drawn wings).
          </li>
          <li>
            Each angle is placed on the preset scale (balanced 0, high downforce
            +1, low drag −1). Rear wing = mean of main plane and flap.
          </li>
          <li>
            Downforce index = 1 + 0.3 × (0.4 front + 0.6 rear); drag index = 1 +
            0.3 × (0.2 front + 0.8 rear). The presets give 1.30, 1.00 and 0.70.
          </li>
          <li>
            Relative teaching numbers, not forces: no newtons, coefficients,
            speeds or lap times. Ride height, suspension, brake bias,
            differential and tyres are not modelled.
          </li>
          <li>
            These indices are not CFD. Solver results (SU2) for a 2D section of
            the rear wing at the same angles are in the CFD panel.
          </li>
        </ul>
      </details>
    </Section>
  );
}

"use client";

import Link from "next/link";
import { useEffect, useRef, useState, type ReactNode } from "react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/cn";
import type { ChatTurn, EngineerEvent } from "@/lib/engineer/engineer";
import { blocks, type Inline } from "@/lib/engineer/format";

interface Turn extends ChatTurn {
  tools?: { label: string; ok: boolean }[];
  error?: string;
  pending?: boolean;
}

interface Props {
  sessionKey: number;
  /** Replay time (ms) the engineer may know about; null = the whole race. Read when a question is sent. */
  until?: number | null;
  suggestions: readonly string[];
  /** In the replay: jump there. On the page: a link into the replay (or null when the race has no replay). */
  onMoment?: (t: number) => void;
  momentHref?: ((t: number) => string) | null;
  compact?: boolean;
}

const MAX_TURNS = 20;

/** Conversation with the Race Engineer (Phase 14). Answers stream from /api/engineer; only finished question/answer pairs are sent back. */
export function EngineerChat({ sessionKey, until = null, suggestions, onMoment, momentHref, compact }: Props) {
  const [turns, setTurns] = useState<Turn[]>([]);
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const [unconfigured, setUnconfigured] = useState(false);
  const abort = useRef<AbortController | null>(null);
  const end = useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    return () => abort.current?.abort();
  }, []);
  useEffect(() => {
    end.current?.scrollIntoView({ block: "nearest" });
  }, [turns]);

  const patchLast = (f: (t: Turn) => Turn) => setTurns((ts) => [...ts.slice(0, -1), f(ts[ts.length - 1])]);

  async function ask(question: string) {
    const q = question.trim().slice(0, 2000);
    if (!q || busy) return;
    // Only answered pairs go back as context, newest last, within the server's limit (it must start with a question).
    const done: ChatTurn[] = [];
    for (let k = 0; k + 1 < turns.length; k += 2) if (!turns[k + 1].error && turns[k + 1].text) done.push({ role: "user", text: turns[k].text }, { role: "assistant", text: turns[k + 1].text });
    const history = [...done.slice(-(MAX_TURNS - 2)), { role: "user" as const, text: q }];
    setTurns((ts) => [...ts, { role: "user", text: q }, { role: "assistant", text: "", tools: [], pending: true }]);
    setInput("");
    setBusy(true);
    const ctrl = new AbortController();
    abort.current = ctrl;
    try {
      const res = await fetch("/api/engineer", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ session: sessionKey, history, until }), signal: ctrl.signal });
      if (res.status === 503) {
        setUnconfigured(true);
        patchLast((t) => ({ ...t, pending: false, error: "The race engineer is not configured on this server." }));
        return;
      }
      if (!res.ok || !res.body) {
        const msg = await res.json().then((j: { error?: string }) => j.error).catch(() => null);
        patchLast((t) => ({ ...t, pending: false, error: `The question could not be sent${msg ? ` (${msg})` : ""}.` }));
        return;
      }
      const reader = res.body.pipeThrough(new TextDecoderStream()).getReader();
      let buf = "";
      for (;;) {
        const { value, done: finished } = await reader.read();
        if (finished) break;
        buf += value;
        const lines = buf.split("\n");
        buf = lines.pop() ?? "";
        for (const line of lines) {
          if (!line.trim()) continue;
          const e = JSON.parse(line) as EngineerEvent;
          if (e.type === "text") patchLast((t) => ({ ...t, text: t.text + e.text }));
          else if (e.type === "tool") patchLast((t) => ({ ...t, tools: [...(t.tools ?? []), { label: e.label, ok: e.ok }] }));
          else if (e.type === "error") patchLast((t) => ({ ...t, error: e.message }));
        }
      }
      patchLast((t) => ({ ...t, pending: false, error: t.error ?? (t.text ? undefined : "No answer came back.") }));
    } catch {
      patchLast((t) => ({ ...t, pending: false, error: ctrl.signal.aborted ? "Stopped." : "The connection was lost before the answer finished." }));
    } finally {
      setBusy(false);
      abort.current = null;
    }
  }

  const renderInline = (parts: Inline[]): ReactNode[] =>
    parts.map((p, k) => {
      if (p.kind === "bold") return <strong key={k} className="font-semibold text-fg">{p.text}</strong>;
      if (p.kind === "text") return <span key={k}>{p.text}</span>;
      const cls = "font-medium text-fg underline decoration-accent/60 underline-offset-2 hover:decoration-accent";
      if (onMoment)
        return (
          <button key={k} type="button" className={cls} onClick={() => onMoment(p.t)}>
            {p.text}
          </button>
        );
      const href = momentHref?.(p.t);
      return href ? (
        <Link key={k} href={href} className={cls}>
          {p.text}
        </Link>
      ) : (
        <span key={k} className="font-medium text-fg">
          {p.text}
        </span>
      );
    });

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className={cn("min-h-0 flex-1 space-y-3 overflow-y-auto", compact ? "px-3 py-2.5" : "py-1")} aria-live="polite" aria-busy={busy}>
        {turns.length === 0 && (
          <div>
            <p className="text-sm text-muted">Ask about this race: results, strategy, battles, flags or weather. Answers use only the race data in APEX F1.</p>
            <ul className="mt-2.5 flex flex-wrap gap-1.5" aria-label="Suggested questions">
              {suggestions.map((s) => (
                <li key={s}>
                  <button type="button" disabled={unconfigured} onClick={() => ask(s)} className="motion-interactive rounded-full border border-white/15 px-2.5 py-1 text-left text-xs text-fg hover:border-accent/60 hover:bg-surface-2 disabled:opacity-50">
                    {s}
                  </button>
                </li>
              ))}
            </ul>
          </div>
        )}
        {turns.map((t, k) =>
          t.role === "user" ? (
            <p key={k} className="ml-auto w-fit max-w-[85%] rounded-lg bg-surface-3 px-3 py-2 text-sm text-fg">
              {t.text}
            </p>
          ) : (
            <div key={k} className="text-sm leading-relaxed text-muted">
              {!!t.tools?.length && (
                <ul className="mb-1.5 flex flex-wrap gap-1" aria-label="Data looked up">
                  {t.tools.map((x, j) => (
                    <li key={j} className={cn("rounded-sm border px-1.5 py-px text-[10px]", x.ok ? "border-white/10 text-subtle" : "border-warning/40 text-warning")}>
                      {x.ok ? `Looked up: ${x.label}` : x.label}
                    </li>
                  ))}
                </ul>
              )}
              {t.pending && !t.text && <p className="text-xs text-subtle">{t.tools?.length ? "Reading the data…" : "Thinking…"}</p>}
              {blocks(t.text).map((b, j) =>
                b.kind === "p" ? (
                  <p key={j} className="mt-1.5 first:mt-0 text-fg/90">
                    {renderInline(b.parts)}
                  </p>
                ) : b.kind === "ul" ? (
                  <ul key={j} className="mt-1.5 list-disc space-y-0.5 pl-5 text-fg/90">
                    {b.items.map((it, n) => (
                      <li key={n}>{renderInline(it)}</li>
                    ))}
                  </ul>
                ) : (
                  <ol key={j} className="mt-1.5 list-decimal space-y-0.5 pl-5 text-fg/90">
                    {b.items.map((it, n) => (
                      <li key={n}>{renderInline(it)}</li>
                    ))}
                  </ol>
                ),
              )}
              {t.error && <p className="mt-1.5 text-xs text-warning">{t.error}</p>}
            </div>
          ),
        )}
        <div ref={end} />
      </div>
      <form
        className={cn("flex items-end gap-2 border-t border-white/10", compact ? "px-3 py-2.5" : "pt-3")}
        onSubmit={(e) => {
          e.preventDefault();
          ask(input);
        }}
      >
        <label className="sr-only" htmlFor={`eng-q-${sessionKey}`}>
          Your question
        </label>
        <textarea
          id={`eng-q-${sessionKey}`}
          rows={compact ? 2 : 2}
          maxLength={2000}
          value={input}
          disabled={unconfigured}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey) {
              e.preventDefault();
              ask(input);
            }
          }}
          placeholder={unconfigured ? "Not configured on this server" : "Ask the engineer…"}
          className="min-h-10 flex-1 resize-none rounded-md border border-line-strong bg-surface-2 px-2.5 py-2 text-sm text-fg placeholder:text-subtle"
        />
        {busy ? (
          <Button type="button" variant="secondary" size="sm" onClick={() => abort.current?.abort()}>
            Stop
          </Button>
        ) : (
          <Button type="submit" size="sm" disabled={!input.trim() || unconfigured}>
            Ask
          </Button>
        )}
      </form>
      <p className={cn("text-[11px] text-subtle", compact ? "px-3 pb-2.5" : "mt-2")}>AI answers from OpenF1 race data in this app. It can still be wrong: check the linked moments.</p>
    </div>
  );
}

/**
 * Client polling for the live state (/api/live): one loop per poller (start() twice does not create a second), never two requests at once,
 * an abortable request, backoff after failures, and nothing left running after stop() (leaving the page or hiding the tab).
 */
export interface PollUpdate<T> {
  data: T | null;
  /** Set while the latest request failed; the previous data is kept. */
  error: string | null;
  failures: number;
}

export interface PollerOptions<T> {
  load: (signal: AbortSignal) => Promise<T>;
  /** Delay before the next request after a success (e.g. the live poll interval, or a minute when nothing is live). */
  nextMs: (data: T) => number;
  onUpdate: (u: PollUpdate<T>) => void;
  schedule?: (fn: () => void, ms: number) => () => void;
  baseBackoffMs?: number;
  maxBackoffMs?: number;
}

export class Poller<T> {
  private running = false;
  private inFlight: AbortController | null = null;
  private cancelTimer: (() => void) | null = null;
  private data: T | null = null;
  private failures = 0;
  private readonly schedule: (fn: () => void, ms: number) => () => void;

  constructor(private readonly o: PollerOptions<T>) {
    this.schedule =
      o.schedule ??
      ((fn, ms) => {
        const id = setTimeout(fn, ms);
        return () => clearTimeout(id);
      });
  }

  start() {
    if (this.running) return;
    this.running = true;
    void this.tick();
  }

  stop() {
    this.running = false;
    this.cancelTimer?.();
    this.cancelTimer = null;
    this.inFlight?.abort();
    this.inFlight = null;
  }

  private async tick() {
    if (!this.running || this.inFlight) return;
    const ctrl = new AbortController();
    this.inFlight = ctrl;
    let next: number;
    try {
      this.data = await this.o.load(ctrl.signal);
      this.failures = 0;
      if (!this.running) return;
      this.o.onUpdate({ data: this.data, error: null, failures: 0 });
      next = this.o.nextMs(this.data);
    } catch (e) {
      if (ctrl.signal.aborted || !this.running) return;
      this.failures++;
      this.o.onUpdate({ data: this.data, error: e instanceof Error ? e.message : "request failed", failures: this.failures });
      next = Math.min(this.o.maxBackoffMs ?? 60_000, (this.o.baseBackoffMs ?? 2000) * 2 ** (this.failures - 1));
    } finally {
      if (this.inFlight === ctrl) this.inFlight = null;
    }
    if (this.running) this.cancelTimer = this.schedule(() => void this.tick(), next);
  }
}

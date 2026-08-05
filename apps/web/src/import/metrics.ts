/**
 * Where the time goes when a document is opened.
 *
 * Two constraints shaped this, and both are unusual enough to state.
 *
 * **Nothing is sent anywhere.** This is instrumentation for a tool whose
 * central promise is that the document never leaves the page, so there is no
 * telemetry endpoint, no sampling, no beacon — measurement that phoned home
 * would falsify the thing it was measuring. Timings are returned to the caller
 * alongside the text, shown in the UI on request, and discarded with the tab.
 *
 * **It measures at the import boundary, not inside the engine.** Phases are
 * named for what the user is waiting for — loading the engine, fetching the
 * model, reading the PDF — not for Scribe's internals. That keeps the numbers
 * comparable across a change of engine, which is the only way a benchmark can
 * answer "is the replacement faster?" rather than "is the replacement
 * instrumented?".
 */

/** One measured stretch of work. */
export interface Phase {
  readonly name: string;
  readonly ms: number;
}

export interface ImportMetrics {
  /** Wall clock for the whole import. */
  readonly totalMs: number;
  readonly phases: readonly Phase[];
  readonly bytes: number;
  readonly chars: number;
  /** Pages recognised, where the engine reported page numbers. */
  readonly ocrPages: number;
  /** True when recognition ran at all, whatever it reported about pages. */
  readonly recognised: boolean;
  /** True when the engine had to be downloaded and started on this import. */
  readonly engineColdStart: boolean;
  /** True when the text came from the session cache and nothing was read. */
  readonly cacheHit: boolean;
}

/**
 * Collects phase timings.
 *
 * `performance.now()` rather than `Date.now()`: it is monotonic, so a clock
 * adjustment mid-OCR cannot produce a negative duration, and it does not
 * expose wall-clock time to anything reading these numbers.
 */
export class ImportTimer {
  private readonly started = performance.now();
  private readonly collected: Phase[] = [];
  private mark = this.started;

  /** Close the current phase and name it. */
  phase(name: string): void {
    const now = performance.now();
    this.collected.push({ name, ms: round(now - this.mark) });
    this.mark = now;
  }

  /** Time one awaited step and close a phase around it. */
  async measure<T>(name: string, work: () => Promise<T>): Promise<T> {
    try {
      return await work();
    } finally {
      this.phase(name);
    }
  }

  finish(facts: Omit<ImportMetrics, "totalMs" | "phases">): ImportMetrics {
    return {
      totalMs: round(performance.now() - this.started),
      // A copy: the timer may outlive the call that reads this, and a
      // caller holding a live reference would see it keep growing.
      phases: [...this.collected],
      ...facts,
    };
  }
}

/** Tenths of a millisecond. Finer than that is timer noise. */
function round(ms: number): number {
  return Math.round(ms * 10) / 10;
}

/** `"engine 812ms · model 4.1s · read 31.7s"` — for the status line. */
export function describePhases(metrics: ImportMetrics): string {
  return metrics.phases
    .filter((phase) => phase.ms >= 1)
    .map((phase) => `${phase.name} ${formatMs(phase.ms)}`)
    .join(" · ");
}

export function formatMs(ms: number): string {
  if (ms < 1000) return `${Math.round(ms)}ms`;
  return `${(ms / 1000).toFixed(1)}s`;
}

/**
 * Throughput, where it means anything.
 *
 * Characters per second over the whole import. Returns `undefined` rather
 * than `Infinity` for an import too fast to divide by, which a caller would
 * otherwise render into the UI.
 */
export function charsPerSecond(metrics: ImportMetrics): number | undefined {
  if (metrics.totalMs <= 0 || metrics.chars === 0) return undefined;
  return Math.round(metrics.chars / (metrics.totalMs / 1000));
}

/**
 * Staying inside CourtListener's published rate limit.
 *
 * The citation-lookup endpoint allows sixty citations a minute per token. A
 * brief with two hundred citations would sail past that in a second and get
 * every subsequent lookup refused, which reads to the user as "CourtListener
 * says these citations do not exist" — the single worst way this integration
 * could fail.
 *
 * So the limit is respected on our side rather than discovered on theirs. The
 * window is rolling: a request is allowed when fewer than `perWindow` requests
 * were started in the last `windowMs`, and otherwise waits exactly as long as
 * it takes for the oldest one to fall out of the window.
 */

export interface ThrottleOptions {
  /** Requests permitted in one window. */
  readonly perWindow: number;
  readonly windowMs?: number;
  /** Injected so tests do not spend a real minute proving this works. */
  readonly now?: () => number;
  readonly sleep?: (ms: number) => Promise<void>;
}

export class RateLimiter {
  private readonly perWindow: number;
  private readonly windowMs: number;
  private readonly now: () => number;
  private readonly sleep: (ms: number) => Promise<void>;
  /** Start times of recent requests, oldest first. */
  private readonly recent: number[] = [];
  /** Serialises `take()` so two callers cannot both see the same free slot. */
  private queue: Promise<void> = Promise.resolve();

  constructor(options: ThrottleOptions) {
    this.perWindow = Math.max(1, options.perWindow);
    this.windowMs = options.windowMs ?? 60_000;
    this.now = options.now ?? (() => Date.now());
    this.sleep =
      options.sleep ??
      ((ms) =>
        new Promise((resolve) => {
          setTimeout(resolve, ms);
        }));
  }

  /** Resolves when it is this caller's turn to make a request. */
  take(): Promise<void> {
    const next = this.queue.then(() => this.waitForSlot());
    // Failures must not poison the queue for everyone behind this caller.
    this.queue = next.catch(() => undefined);
    return next;
  }

  private async waitForSlot(): Promise<void> {
    for (;;) {
      const cutoff = this.now() - this.windowMs;
      while (this.recent.length > 0 && this.recent[0]! <= cutoff) this.recent.shift();

      if (this.recent.length < this.perWindow) {
        this.recent.push(this.now());
        return;
      }

      // `+1` so the oldest entry is strictly outside the window when we look
      // again; without it a clock with millisecond resolution can spin.
      await this.sleep(this.recent[0]! + this.windowMs - this.now() + 1);
    }
  }
}

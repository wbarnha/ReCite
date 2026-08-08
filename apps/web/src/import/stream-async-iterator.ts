/**
 * Async iteration over a `ReadableStream`, where the browser has none.
 *
 * `for await (const chunk of stream)` is part of the Streams standard, and
 * Safari has not shipped it. Asking for the iterator gets `undefined`, calling
 * it throws `undefined is not a function`, and that is the whole of the bug an
 * iPhone user reported against the example filing:
 *
 * > undefined is not a function (near '...e of t...')
 *
 * The `...e of t...` is JavaScriptCore quoting the source it choked on, and the
 * source is inside `pdfjs-dist`:
 *
 * ```js
 * const stream = this.streamTextContent(...);
 * for await (const chunk of stream) { ... }   // ← here
 * ```
 *
 * So **every PDF fails**, scanned or not, about two seconds in — as soon as the
 * first page's text layer is read. A `.txt` is unaffected because it never goes
 * near pdf.js, which is exactly the shape the report had.
 *
 * It is not something ReCite can route around: the call is pdf.js's own, on the
 * only path that gets text out of a page. What ReCite can do is give the
 * browser the iterator the standard says it should have.
 *
 * ## Why a polyfill rather than a version bump
 *
 * The gap is in the browser, not in pdf.js. A newer pdf.js would write the same
 * loop, because the loop is correct — and pinning ReCite to a version chosen
 * for a workaround would make every future upgrade a re-litigation of this.
 *
 * ## Why this shape
 *
 * `getReader()` is the primitive the async iterator is defined in terms of, and
 * it is everywhere. The wrapper below is the specification's own algorithm
 * (Streams §4.6, "asynchronous iteration"), including the `return()` path that
 * cancels the stream when a loop is left early — without which a `break` or a
 * `throw` leaks a locked stream, which is worse than the bug being fixed.
 *
 * Installed once, and only where it is missing: a browser that has it keeps its
 * own, which is always the better implementation.
 */

interface AsyncIterableStream<T> {
  getReader(): {
    read(): Promise<{ done: boolean; value?: T }>;
    cancel(reason?: unknown): Promise<void>;
    releaseLock(): void;
  };
}

/** Whether this browser can already do it. Exported so a test can assert it. */
export function streamsAreAsyncIterable(): boolean {
  const prototype = (globalThis as { ReadableStream?: { prototype?: object } })
    .ReadableStream?.prototype;
  if (!prototype) return false;
  return (
    typeof (prototype as Record<symbol, unknown>)[Symbol.asyncIterator] === "function"
  );
}

/**
 * Give `ReadableStream` an async iterator where it has none.
 *
 * Idempotent, and a no-op on every browser that implements the standard.
 * Returns whether it installed anything, so the caller can say so if it ever
 * needs to.
 */
export function installStreamAsyncIterator(): boolean {
  if (streamsAreAsyncIterable()) return false;

  const prototype = (globalThis as { ReadableStream?: { prototype?: object } })
    .ReadableStream?.prototype;
  if (!prototype) return false;

  function values<T>(
    this: AsyncIterableStream<T>,
    options: { preventCancel?: boolean } = {},
  ): AsyncIterableIterator<T> {
    const { preventCancel = false } = options;
    const reader = this.getReader();

    return {
      async next(): Promise<IteratorResult<T>> {
        try {
          const { done, value } = await reader.read();
          if (done) {
            reader.releaseLock();
            return { done: true, value: undefined };
          }
          return { done: false, value: value as T };
        } catch (error) {
          // A stream that failed must not stay locked, or the next reader gets
          // a confusing "already locked" instead of the real fault.
          reader.releaseLock();
          throw error;
        }
      },

      // `break`, `return` and `throw` inside the loop all land here. Cancelling
      // is what the standard does, and releasing the lock is what keeps a later
      // read from failing for a reason that has nothing to do with itself.
      async return(value?: unknown): Promise<IteratorResult<T>> {
        if (!preventCancel) await reader.cancel(value).catch(() => undefined);
        reader.releaseLock();
        return { done: true, value: value as T };
      },

      [Symbol.asyncIterator](): AsyncIterableIterator<T> {
        return this;
      },
    };
  }

  const target = prototype as Record<string | symbol, unknown>;
  target[Symbol.asyncIterator] = values;
  // The standard names it both ways, and code in the wild uses `.values()`.
  target["values"] ??= values;
  return true;
}

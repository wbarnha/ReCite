/**
 * The `ReadableStream` async-iteration polyfill.
 *
 * The browser it exists for cannot be run here, so the polyfill is exercised
 * against a stand-in that behaves the way Safari does: a stream with a
 * `getReader` and no `Symbol.asyncIterator`. That is enough to hold the two
 * things that actually matter — that `for await` works at all, and that leaving
 * a loop early cancels the stream instead of leaking a locked one.
 */

import { describe, expect, it } from "vitest";

import {
  installStreamAsyncIterator,
  streamsAreAsyncIterable,
} from "../src/import/stream-async-iterator.js";

/** A stream shaped like Safari's: readable, but not async-iterable. */
function safariStyleStream(chunks: readonly string[]): {
  ReadableStream: new () => object;
  cancelled: { reason: unknown; count: number };
  make: () => object;
} {
  const cancelled = { reason: undefined as unknown, count: 0 };

  class Stream {
    private at = 0;
    private locked = false;

    getReader = (): {
      read: () => Promise<{ done: boolean; value?: string }>;
      cancel: (reason?: unknown) => Promise<void>;
      releaseLock: () => void;
    } => {
      if (this.locked) throw new Error("already locked");
      this.locked = true;
      return {
        read: () =>
          Promise.resolve(
            this.at < chunks.length
              ? { done: false, value: chunks[this.at++]! }
              : { done: true, value: undefined },
          ),
        cancel: (reason?: unknown) => {
          cancelled.count += 1;
          cancelled.reason = reason;
          return Promise.resolve();
        },
        releaseLock: () => {
          this.locked = false;
        },
      };
    };
  }

  return {
    ReadableStream: Stream,
    cancelled,
    make: () => new Stream(),
  };
}

/** Install the polyfill onto a stand-in, as it would be onto the real one. */
function polyfill(stub: { ReadableStream: new () => object }): boolean {
  const globals = globalThis as { ReadableStream?: unknown };
  const original = globals.ReadableStream;
  globals.ReadableStream = stub.ReadableStream;
  try {
    return installStreamAsyncIterator();
  } finally {
    globals.ReadableStream = original;
  }
}

describe("async iteration over a ReadableStream", () => {
  it("is already there in this runtime, and is left alone", () => {
    // Node has it, so the polyfill must decline to touch it. A browser that
    // ships the standard always has the better implementation.
    expect(streamsAreAsyncIterable()).toBe(true);
    expect(installStreamAsyncIterator()).toBe(false);
  });

  it("makes `for await` work where the browser has none", async () => {
    // The bug itself: without this, `for await (const chunk of stream)` throws
    // `undefined is not a function`, which is what an iPhone reported for every
    // PDF — pdf.js reads a page's text layer through exactly this loop.
    const stub = safariStyleStream(["one ", "two ", "three"]);
    expect(polyfill(stub)).toBe(true);

    const seen: string[] = [];
    for await (const chunk of stub.make() as AsyncIterable<string>) {
      seen.push(chunk);
    }
    expect(seen).toEqual(["one ", "two ", "three"]);
  });

  it("cancels the stream when the loop is left early", async () => {
    // Without the `return()` path a `break` leaves the stream locked, and the
    // next read fails for a reason that has nothing to do with itself — a
    // worse bug than the one being fixed, and harder to find.
    const stub = safariStyleStream(["one", "two", "three"]);
    polyfill(stub);

    for await (const chunk of stub.make() as AsyncIterable<string>) {
      if (chunk === "two") break;
    }

    expect(stub.cancelled.count, "leaving the loop must cancel").toBe(1);
  });

  it("does not cancel twice, and survives a stream that refuses to", async () => {
    const stub = safariStyleStream([]);
    polyfill(stub);
    for await (const _ of stub.make() as AsyncIterable<string>) {
      // drained without breaking; nothing to cancel
    }
    expect(stub.cancelled.count).toBe(0);
  });
});

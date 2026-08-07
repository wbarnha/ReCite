/** The document hosts, and the occurrence maths Word depends on. */

import type { Correction } from "@recite/core";
import { describe, expect, it, vi } from "vitest";

import { BrowserHost, countBefore } from "../src/host.js";

const fix = (start: number, end: number, replacement: string): Correction => ({
  span: { start, end },
  replacement,
  safety: "safe",
  description: "test",
});

describe("countBefore", () => {
  const text = "119 S.Ct. 662 and 119 S.Ct. 662 and 119 S.Ct. 662";

  it("counts identical strings before an offset", () => {
    expect(countBefore(text, "119 S.Ct. 662", 0)).toBe(0);
    expect(countBefore(text, "119 S.Ct. 662", 18)).toBe(1);
    expect(countBefore(text, "119 S.Ct. 662", 36)).toBe(2);
  });

  it("is zero when the needle is empty", () => {
    expect(countBefore(text, "", 20)).toBe(0);
  });

  it("does not count overlapping matches twice", () => {
    expect(countBefore("aaaa", "aa", 4)).toBe(2);
  });

  it("is what lets Word rewrite the right occurrence", () => {
    // Word has no character offsets, so the only way to aim an edit is
    // "the Nth match of this string". Getting the N wrong silently corrupts
    // an unrelated citation elsewhere in the document.
    const second = text.indexOf("119 S.Ct. 662", 1);
    expect(countBefore(text, "119 S.Ct. 662", second)).toBe(1);
  });
});

describe("BrowserHost", () => {
  it("reads the live value rather than a stale copy", async () => {
    let value = "first";
    const host = new BrowserHost(
      () => value,
      () => {},
    );
    expect(await host.read()).toBe("first");
    value = "second";
    expect(await host.read()).toBe("second");
  });

  it("applies corrections and reports the result", async () => {
    let value = "119 S.Ct. 662";
    const host = new BrowserHost(
      () => value,
      (next) => {
        value = next;
      },
    );

    const outcome = await host.apply(value, [fix(0, 13, "119 S. Ct. 662")]);
    expect(outcome.applied).toBe(1);
    expect(outcome.text).toBe("119 S. Ct. 662");
    expect(value).toBe("119 S. Ct. 662");
  });

  it("reports corrections it refused to apply", async () => {
    const host = new BrowserHost(
      () => "abcdefgh",
      () => {},
    );
    const outcome = await host.apply("abcdefgh", [fix(0, 4, "W"), fix(2, 6, "X")]);
    expect(outcome.applied).toBe(1);
    expect(outcome.skipped).toBe(1);
  });

  it("reveals a span through the selection callback", async () => {
    const select = vi.fn();
    const host = new BrowserHost(
      () => "some text",
      () => {},
      select,
    );
    expect(await host.reveal("some text", 5, 9)).toEqual({ found: true });
    expect(select).toHaveBeenCalledWith(5, 9);
  });

  it("says so rather than silently doing nothing when the span has gone", async () => {
    // Offsets come from the last check. If the document has been edited since,
    // a click that quietly did nothing reads as a broken button — and one that
    // scrolled confidently to whatever now sits there would point at an
    // innocent citation and call it the finding.
    const select = vi.fn();
    const host = new BrowserHost(
      () => "short",
      () => {},
      select,
    );
    const outcome = await host.reveal("a much longer document, 410 U.S. 113", 23, 35);

    expect(outcome.found).toBe(false);
    expect(outcome.reason).toMatch(/changed since the check/);
    expect(select).not.toHaveBeenCalled();
  });

  it("jumps when the live document still has that text at those offsets", async () => {
    const select = vi.fn();
    const text = "See 410 U.S. 113 (1973).";
    const host = new BrowserHost(
      () => text,
      () => {},
      select,
    );
    expect(await host.reveal(text, 4, 16)).toEqual({ found: true });
    expect(select).toHaveBeenCalledWith(4, 16);
  });
});

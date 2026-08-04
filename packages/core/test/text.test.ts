/** Span arithmetic and patching — the part that must never corrupt a document. */

import { describe, expect, it } from "vitest";

import type { Correction } from "../src/model.js";
import { lineCol, span, spansOverlap } from "../src/model.js";
import { applyCorrections, lineDiff, snippet } from "../src/text.js";

const fix = (start: number, end: number, replacement: string): Correction => ({
  span: span(start, end),
  replacement,
  safety: "safe",
  description: "test",
});

describe("span", () => {
  it("rejects an inverted range", () => {
    expect(() => span(5, 2)).toThrow(RangeError);
  });

  it("rejects a negative start", () => {
    expect(() => span(-1, 4)).toThrow(RangeError);
  });

  it.each([
    [[0, 5], [3, 8], true],
    [[0, 5], [5, 8], false],
    [[0, 5], [6, 8], false],
    [[2, 4], [0, 10], true],
  ] as const)("overlap of %j and %j is %s", (a, b, expected) => {
    expect(spansOverlap(span(a[0], a[1]), span(b[0], b[1]))).toBe(expected);
    expect(spansOverlap(span(b[0], b[1]), span(a[0], a[1]))).toBe(expected);
  });

  it("treats zero-length spans as never overlapping", () => {
    expect(spansOverlap(span(3, 3), span(0, 10))).toBe(false);
  });
});

describe("applyCorrections", () => {
  it("applies edits back to front so offsets stay valid", () => {
    const result = applyCorrections("one two three", [
      fix(0, 3, "ONE"),
      fix(8, 13, "THREE"),
    ]);
    expect(result.text).toBe("ONE two THREE");
    expect(result.applied).toHaveLength(2);
  });

  it("skips an overlapping correction rather than corrupting the text", () => {
    const result = applyCorrections("119 S.Ct. 662", [
      fix(0, 13, "119 S. Ct. 662"),
      fix(4, 9, "S. Ct."),
    ]);
    expect(result.text).toBe("119 S. Ct. 662");
    expect(result.applied).toHaveLength(1);
    expect(result.skipped[0]?.[1]).toMatch(/overlaps/);
  });

  it("gives the same result whatever order corrections arrive in", () => {
    const forward = applyCorrections("abcdefgh", [fix(0, 4, "W"), fix(2, 6, "X")]);
    const reverse = applyCorrections("abcdefgh", [fix(2, 6, "X"), fix(0, 4, "W")]);
    expect(forward.text).toBe(reverse.text);
    expect(forward.text).toBe("Wefgh");
  });

  it("drops a correction that changes nothing", () => {
    const result = applyCorrections("hello", [fix(0, 5, "hello")]);
    expect(result.applied).toHaveLength(0);
    expect(result.skipped[0]?.[1]).toMatch(/identical/);
  });

  it("refuses a correction past the end of the document", () => {
    const result = applyCorrections("short", [fix(0, 99, "x")]);
    expect(result.text).toBe("short");
    expect(result.skipped[0]?.[1]).toMatch(/past end/);
  });

  it("leaves the text alone when there is nothing to do", () => {
    const result = applyCorrections("unchanged", []);
    expect(result.text).toBe("unchanged");
    expect(result.changed).toBe(false);
  });
});

describe("lineCol", () => {
  it.each([
    [0, [1, 1]],
    [3, [1, 4]],
    [4, [2, 1]],
    [7, [2, 4]],
  ] as const)("offset %i is at %j", (offset, expected) => {
    expect(lineCol("abc\ndef\nghi", offset)).toEqual(expected);
  });

  it("clamps an offset past the end", () => {
    expect(lineCol("abc", 99)).toEqual([1, 4]);
  });

  it("rejects a negative offset", () => {
    expect(() => lineCol("abc", -1)).toThrow(RangeError);
  });
});

describe("lineDiff", () => {
  it("is empty when nothing changed", () => {
    expect(lineDiff("same", "same")).toBe("");
  });

  it("shows the line that changed", () => {
    const diff = lineDiff("a\nb\n", "a\nc\n");
    expect(diff).toContain("- b");
    expect(diff).toContain("+ c");
  });
});

describe("snippet", () => {
  it("collapses newlines and marks truncation", () => {
    const text = `${"x".repeat(100)}\n925 F.3d 1339\n${"y".repeat(100)}`;
    const out = snippet(text, span(101, 114));
    expect(out).not.toContain("\n");
    expect(out.startsWith("…")).toBe(true);
    expect(out.endsWith("…")).toBe(true);
  });
});

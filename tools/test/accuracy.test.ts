/**
 * The benchmark's accuracy scorer.
 *
 * Tested because a benchmark that scores wrong is worse than no benchmark: it
 * gives a number, and a number gets believed.
 */

import { describe, expect, it } from "vitest";

import { citationAccuracy, editDistance, similarity } from "../bench/accuracy.js";

describe("edit distance", () => {
  it("is zero for identical strings", () => {
    expect(editDistance("abc", "abc")).toBe(0);
  });

  it("counts substitutions, insertions and deletions", () => {
    expect(editDistance("kitten", "sitting")).toBe(3);
    expect(editDistance("", "abc")).toBe(3);
    expect(editDistance("abc", "")).toBe(3);
  });

  it("is symmetric", () => {
    expect(editDistance("F.3d", "F.Ed")).toBe(editDistance("F.Ed", "F.3d"));
  });
});

describe("similarity", () => {
  it("ignores case and whitespace, which OCR does not preserve anyway", () => {
    expect(similarity("Iqbal,  556 U.S. 662", "iqbal, 556 u.s. 662")).toBe(1);
  });

  it("falls with damage", () => {
    const clean = similarity("556 U.S. 662", "556 U.S. 662");
    const damaged = similarity("556 U.S. 662", "SS6 U.S. 66Z");
    expect(clean).toBe(1);
    expect(damaged).toBeLessThan(clean);
    expect(damaged).toBeGreaterThan(0.5);
  });

  it("treats two empty strings as identical rather than dividing by zero", () => {
    expect(similarity("", "")).toBe(1);
  });
});

describe("citation recall", () => {
  const brief =
    "Miller v. United Airlines, Inc., 174 F.3d 366 (2d Cir. 1999). See Iqbal, 556 U.S. 662 (2009).";

  it("is total for a perfect read", () => {
    const score = citationAccuracy(brief, brief);
    expect(score.expected).toBeGreaterThan(0);
    expect(score.recall).toBe(1);
    expect(score.lost).toEqual([]);
  });

  it("notices a citation OCR destroyed", () => {
    // `174 F.3d 366` misread as `174 F.Ed 366` is exactly the failure this
    // benchmark exists to catch: the sentence still reads fine, and the
    // citation is gone.
    const damaged = brief.replace("174 F.3d 366", "174 F.Ed 366");
    const score = citationAccuracy(brief, damaged);

    expect(score.recall).toBeLessThan(1);
    expect(score.lost).toContain("174 f.3d 366");
  });

  it("ignores the offsets OCR shifts", () => {
    // Recognition moves every character position in the document. Comparing
    // spans would report total failure for a perfect read.
    const padded = `Preliminary Statement\n\n${brief}`;
    expect(citationAccuracy(brief, padded).recall).toBe(1);
  });

  it("counts citations that were invented", () => {
    const extra = `${brief} Also 999 F.3d 1 (2d Cir. 2020).`;
    expect(citationAccuracy(brief, extra).spurious).toBe(1);
  });

  it("does not divide by zero for a document with no citations", () => {
    expect(citationAccuracy("no authority here", "none here either").recall).toBe(1);
  });
});

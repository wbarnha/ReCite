/**
 * The seam between vendored upstream data and ReCite's own annotations.
 *
 * `overlay.ts` adds the two things `reporters-db` has no reason to record and
 * ReCite has rules about. It can fail in exactly one way that nothing else
 * would notice: an upstream rename leaves an annotation matching nothing, the
 * flag silently stops applying, and the rule that depended on it quietly stops
 * firing. A rule that fails *open* reports nothing and looks fine.
 *
 * So that case is a test.
 */

import { describe, expect, it } from "vitest";

import { ANNOTATIONS, unmatchedAnnotations } from "../src/data/overlay.js";
import {
  REPORTERS,
  UPSTREAM_REVISION,
  UPSTREAM_SOURCE,
} from "../src/data/reporters.js";

describe("the local overlay still lands on real reporters", () => {
  const known = new Set(REPORTERS.map((edition) => edition.abbrev));

  it("annotates nothing that upstream no longer has", () => {
    // This caught two dead entries the first time it ran: `Fed. Appx.` and
    // `F. Appx.` were listed as non-precedential, but upstream carries them as
    // variations of `F. App'x` rather than as editions, so they annotated no
    // reporter at all.
    expect(unmatchedAnnotations(known)).toEqual([]);
  });

  it("reaches the merged table", () => {
    expect(REPORTERS.find((e) => e.abbrev === "U.S.")?.scotusOnly).toBe(true);
    expect(REPORTERS.find((e) => e.abbrev === "F. App'x")?.nonPrecedential).toBe(true);
  });

  it("annotates exactly the reporters it lists", () => {
    const annotated = REPORTERS.filter((e) => e.scotusOnly ?? e.nonPrecedential);
    expect(annotated).toHaveLength(ANNOTATIONS.size);
  });

  it("never changes a date", () => {
    // Dates come from upstream, full stop. A local override would mean quietly
    // disagreeing with the source ReCite names as its authority.
    for (const [, annotation] of ANNOTATIONS) {
      expect(Object.keys(annotation)).not.toContain("start");
      expect(Object.keys(annotation)).not.toContain("end");
    }
  });

  it("resolves a variation spelling to the annotated canonical entry", () => {
    // Why the dead entries made no visible difference: `findReporter` squashes
    // punctuation, so `F. Appx.` already resolved to `F. App'x`.
    expect(REPORTERS.some((e) => e.abbrev === "Fed. Appx.")).toBe(false);
  });
});

describe("provenance", () => {
  it("records the revision the table came from", () => {
    expect(UPSTREAM_REVISION).toMatch(/^v\d+\.\d+\.\d+$/);
    expect(UPSTREAM_SOURCE).toBe("https://github.com/freelawproject/reporters-db");
  });

  it("carries far more reporters than the hand-written table did", () => {
    // Fifty-one, before. The point of vendoring was coverage: a state series
    // nobody thought to type in is no longer an unknown reporter.
    expect(REPORTERS.length).toBeGreaterThan(1000);
  });

  it("marks the abbreviations more than one reporter claims", () => {
    const ambiguous = REPORTERS.filter((e) => e.ambiguous);
    expect(ambiguous.length).toBeGreaterThan(0);
    // The union of the spans, so a year check accuses nobody it should not.
    for (const edition of ambiguous) {
      expect(edition.end === null || edition.end >= edition.start).toBe(true);
    }
  });
});

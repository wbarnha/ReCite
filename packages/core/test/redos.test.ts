/**
 * Every pattern, against every shape known to make a regex engine backtrack.
 *
 * The two superlinear patterns this project has actually shipped were both
 * found by hand, one of them only after a linter pointed at the wrong line. So
 * this suite does not take a list of patterns to check — it enumerates
 * {@link buildPatterns} and covers whatever is there. A pattern added next year
 * is tested the day it is written, by someone who does not have to remember
 * this file exists.
 *
 * The measurement is a growth ratio, not a wall-clock budget. Absolute times
 * vary with the machine and with load; the thing that distinguishes linear from
 * quadratic is that quadratic grows about sixteenfold when the input grows
 * fourfold. Comparing a pattern against itself makes the test meaningful on a
 * loaded CI runner, where a fixed threshold would either be flaky or so loose
 * it caught nothing.
 */

import { describe, expect, it } from "vitest";

import { InputTooLargeError, MAX_INPUT_CHARS } from "../src/limits.js";
import { parse } from "../src/parse.js";
import { buildPatterns } from "../src/patterns.js";

/**
 * Input shapes chosen to attack a different structure in each case: runs that
 * an ambiguous quantifier pair can split, repetition that a nested quantifier
 * can re-partition, and prefixes that match most of a pattern before failing.
 */
const ATTACKS: ReadonlyArray<readonly [string, (n: number) => string]> = [
  ["a run of spaces", (n) => `1${" ".repeat(n)}F.3d 2`],
  ["a run of digits", (n) => "9".repeat(n)],
  ["repeated abbreviation dots", (n) => `1 ${"F.".repeat(n)} 2`],
  ["comma-separated numbers", (n) => `1 U.S. 2, ${"3, ".repeat(n)}`],
  ["a storm of dashes", (n) => `1 U.S. 2, ${"3-".repeat(n)}4`],
  ["nested subsection parens", (n) => `11 U.S.C. § 1${"(a)".repeat(n)}`],
  ["a section list that never ends", (n) => `11 U.S.C. §§ 1${", 2".repeat(n)}`],
  ["a section span that never ends", (n) => `11 U.S.C. §§ 1${"-2".repeat(n)}`],
  // `\d(?:[\w.]*\w)?` in a section number is two overlapping character
  // classes, and a run of periods is what makes an engine try both ways.
  ["a section number of periods", (n) => `11 U.S.C. § 1${".".repeat(n)}`],
  ["capitalised words", (n) => `${"Abc ".repeat(n)}supra`],
  [
    "spaces inside an abbreviation",
    (n) => `1 F.${" ".repeat(n)}Supp.${" ".repeat(n)}2d 3`,
  ],
  ["an unclosed parenthesis", (n) => `1 U.S. 2 (${"x".repeat(n)}`],
  ["whitespace after Id. at", (n) => `Id. at ${" ".repeat(n)}1`],
  ["a run of periods", (n) => ".".repeat(n)],
  ["repeated volume-reporter prefixes", (n) => "123 F. ".repeat(n)],
];

/** Run a pattern to exhaustion and return milliseconds taken. */
function timePattern(pattern: RegExp, input: string): number {
  // A fresh object: `lastIndex` is mutable state and these run repeatedly.
  const regex = new RegExp(pattern.source, pattern.flags);
  const started = performance.now();
  if (regex.global) {
    regex.lastIndex = 0;
    while (regex.exec(input) !== null) {
      if (regex.lastIndex === 0) break;
    }
  } else {
    regex.exec(input);
  }
  return performance.now() - started;
}

/** Run `fn` and hand back whatever it threw, so assertions stay unconditional. */
function capture(fn: () => unknown): unknown {
  try {
    fn();
  } catch (error) {
    return error;
  }
  return undefined;
}

const PATTERNS = Object.entries(buildPatterns()).filter(
  (entry): entry is [string, RegExp] => entry[1] instanceof RegExp,
);

describe("every pattern is linear", () => {
  it("covers every pattern the parser builds", () => {
    // If this fails, `buildPatterns` gained a pattern that is not a RegExp and
    // the sweep below is quietly skipping it.
    expect(PATTERNS.length).toBe(Object.keys(buildPatterns()).length);
    expect(PATTERNS.length).toBeGreaterThan(5);
  });

  const cases = PATTERNS.flatMap(([name, pattern]) =>
    ATTACKS.map(([shape, generate]) => ({ name, pattern, shape, generate })),
  );

  it.each(cases.map((c) => [`${c.name} on ${c.shape}`, c] as const))(
    "%s",
    (_label, { pattern, generate }) => {
      // Large enough that a quadratic pattern is unmistakable, small enough
      // that the whole sweep stays quick.
      const small = timePattern(pattern, generate(8_000));
      const large = timePattern(pattern, generate(32_000));

      // Four times the input. Linear predicts ~4x, quadratic ~16x. The floor
      // on `small` keeps a sub-millisecond baseline from turning timer noise
      // into a huge ratio; the additive term does the same for the difference.
      expect(large).toBeLessThan(Math.max(small, 1) * 8 + 100);
    },
  );
});

describe("the input ceiling", () => {
  it("refuses a document past the limit instead of truncating it", () => {
    // Refusing matters more than it might look: a checker that silently read
    // the first few megabytes would report a clean document, and nobody could
    // tell that from a document that was actually clean.
    expect(() => parse("x".repeat(MAX_INPUT_CHARS + 1))).toThrow(InputTooLargeError);
  });

  it("accepts a document at exactly the limit", () => {
    expect(() => parse("x".repeat(MAX_INPUT_CHARS))).not.toThrow();
  });

  it("says how long the document was and what the limit is", () => {
    const thrown = capture(() => parse("x".repeat(MAX_INPUT_CHARS + 5)));

    expect(thrown).toBeInstanceOf(InputTooLargeError);
    const typed = thrown as InputTooLargeError;
    expect(typed.length).toBe(MAX_INPUT_CHARS + 5);
    expect(typed.limit).toBe(MAX_INPUT_CHARS);
    // Actionable: the reader is told what to do about it.
    expect(typed.message).toMatch(/[Ss]plit/);
  });

  it("is distinguishable from a parser bug", () => {
    // The whole reason for a named type: a caller can tell a document it can
    // do something about from a defect it cannot.
    const tooLarge: unknown = new InputTooLargeError(1, 0);
    expect(tooLarge).toBeInstanceOf(Error);
    expect((tooLarge as Error).name).toBe("InputTooLargeError");
  });

  it("leaves realistic documents far below the ceiling", () => {
    // A 2,000-citation brief, which is already an unusually long one.
    const brief = "Smith v. Jones, 123 F.3d 456, 460-62 (9th Cir. 1997). ".repeat(
      2_000,
    );
    expect(brief.length).toBeLessThan(MAX_INPUT_CHARS / 50);
  });
});

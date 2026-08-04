/**
 * The parser must stay fast on hostile input.
 *
 * ReCite runs inside a Word task pane and a browser tab, on whatever a user
 * pastes. A pattern that degrades badly is a denial of service against the
 * person using it: the pane simply stops responding. These tests pin the
 * shapes that previously misbehaved, and assert the parser still finishes on
 * inputs designed to make a regex engine backtrack.
 */

import { describe, expect, it } from "vitest";

import { antecedentBefore, parse } from "../src/parse.js";

/** Generous enough not to be flaky on a loaded runner, tight enough to catch O(n²). */
const BUDGET_MS = 1500;

function timeParse(input: string): number {
  const started = performance.now();
  parse(input);
  return performance.now() - started;
}

describe("pathological input", () => {
  it.each([
    ["a long run of spaces before a reporter", "1" + " ".repeat(20_000) + "F.3d 2"],
    [
      "spaces inside a multi-token abbreviation",
      "1 F." + " ".repeat(10_000) + "Supp." + " ".repeat(10_000) + "2d 3",
    ],
    ["a very long run of digits", "9".repeat(50_000)],
    ["an unclosed parenthesis", "1 U.S. 2 (" + "x".repeat(50_000)],
    ["deeply nested parentheses", "1 U.S. 2 " + "(".repeat(5_000) + "1999"],
    ["a storm of comma-separated numbers", "1 U.S. 2" + ", 3".repeat(20_000)],
    ["a storm of dashes", "1 U.S. 2, " + "3-".repeat(20_000) + "4"],
    ["repeated partial reporter prefixes", "123 F. ".repeat(10_000)],
    ["a statute-shaped repetition", "11 U.S.C. § " + "1(a)".repeat(10_000)],
  ])("finishes promptly on %s", (_name, input) => {
    expect(timeParse(input)).toBeLessThan(BUDGET_MS);
  });

  it("finishes promptly on many capitalised words before a citation", () => {
    // This shape was quadratic: the `supra` pattern used to match an optional
    // run of capitalised words before the literal, so every failing position
    // backtracked through the entire run. 16,000 words took over two seconds.
    expect(timeParse("A ".repeat(50_000) + "v. B, 1 U.S. 2 (1999)")).toBeLessThan(
      BUDGET_MS,
    );
  });

  it("scales linearly in the number of capitalised words", () => {
    const small = timeParse("A ".repeat(4_000) + "supra");
    const large = timeParse("A ".repeat(16_000) + "supra");

    // Quadratic growth would be ~16x for a 4x input. Allow generous headroom
    // for timer noise while still failing loudly if the blowup returns.
    expect(large).toBeLessThan(Math.max(small, 1) * 8 + 200);
  });

  it("handles a large realistic brief", () => {
    const brief = "Smith v. Jones, 123 F.3d 456, 460-62 (9th Cir. 1997). ".repeat(
      2_000,
    );
    const started = performance.now();
    const result = parse(brief);
    expect(performance.now() - started).toBeLessThan(BUDGET_MS);
    expect(result.citations).toHaveLength(2_000);
  });
});

describe("antecedentBefore", () => {
  it("reads the name in front of a supra", () => {
    const text = "As held in Ghost Corp., supra, at 3.";
    expect(antecedentBefore(text, text.indexOf("supra"))).toBe("Ghost Corp.");
  });

  it("drops the signal that introduced it", () => {
    const text = "See Ghost Corp., supra";
    expect(antecedentBefore(text, text.indexOf("supra"))).toBe("Ghost Corp.");
  });

  it("returns nothing when no name precedes it", () => {
    expect(antecedentBefore("supra", 0)).toBeUndefined();
    expect(antecedentBefore("as noted above, supra", 16)).toBeUndefined();
  });

  it("looks back only a bounded distance", () => {
    // Bounded by construction; this is what keeps it linear.
    const text = "Z ".repeat(10_000) + "supra";
    const started = performance.now();
    antecedentBefore(text, text.indexOf("supra"));
    expect(performance.now() - started).toBeLessThan(50);
  });

  it("still lets a supra resolve to its antecedent", () => {
    const result = parse(
      "Ghost Corp. v. Other, 1 U.S. 2 (1999). As held in Ghost Corp., supra, at 3.",
    );
    const supra = result.citations.find((c) => c.kind === "supra");
    expect(supra?.caseName).toBe("Ghost Corp.");
    expect(supra?.resourceKey).toBe("1 U.S. 2");
  });
});

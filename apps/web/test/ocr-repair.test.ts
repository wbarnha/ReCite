/**
 * The section-symbol repair.
 *
 * Tested harder than its size suggests, because it is the one place in the
 * import path that rewrites recognised text rather than passing it through.
 * Anything it gets wrong is a citation that reads correctly and points
 * somewhere else.
 */

import { parse } from "@recite/core";
import { describe, expect, it } from "vitest";

import { repairSectionSymbols } from "../src/import/ocr-repair.js";

describe("repairing what OCR did to the section symbol", () => {
  it("removes a digit invented between two symbols", () => {
    // The exact failure measured against the benchmark fixture.
    expect(repairSectionSymbols("18 U.S.C. §8§ 1544, 1546 (2012).")).toBe(
      "18 U.S.C. §§ 1544, 1546 (2012).",
    );
  });

  it("replaces a fabricated citation with the real one", () => {
    // Worth stating precisely, because it is worse than a loss. Left alone,
    // the parser reads `§8§ 1544, 1546` as a citation to **section 8** — an
    // authority the document never cited, reported with no warning. A
    // citation checker that invents citations is the exact failure this
    // project exists to catch.
    const damaged = "18 U.S.C. §8§ 1544, 1546 (2012).";
    expect(parse(damaged).citations[0]?.text).toBe("18 U.S.C. §8");

    const repaired = parse(repairSectionSymbols(damaged)).citations;
    expect(repaired).toHaveLength(1);
    expect(repaired[0]?.text).toBe("18 U.S.C. §§ 1544, 1546");
    expect(repaired[0]?.sections).toBe("1544, 1546");
  });

  it("handles C.F.R. and spacing variants", () => {
    expect(repairSectionSymbols("17 C.F.R. §8§ 240.10 (2020).")).toBe(
      "17 C.F.R. §§ 240.10 (2020).",
    );
    expect(repairSectionSymbols("18 U. S. C. §8§ 1544.")).toBe("18 U. S. C. §§ 1544.");
  });

  it("leaves a correctly read citation exactly as it was", () => {
    for (const clean of [
      "18 U.S.C. §§ 1544, 1546 (2012).",
      "17 U.S.C. § 501 (2012).",
      "11 U.S.C. § 362(a)(1).",
      "17 C.F.R. § 240.10b-5 (2012).",
    ]) {
      expect(repairSectionSymbols(clean), clean).toBe(clean);
    }
  });

  it("refuses to invent a symbol that did not survive", () => {
    // `88` with no `§` anywhere is indistinguishable from a reference to
    // section 88. Fabricating a citation is worse than failing to recover one.
    const lost = "18 U.S.C. 88 1544, 1546 (2012).";
    expect(repairSectionSymbols(lost)).toBe(lost);
  });

  it("does not touch digits outside a section run", () => {
    // Volume numbers, page numbers, years and section numbers all contain 8s.
    for (const text of [
      "888 F.3d 88, 88-89 (8th Cir. 1988).",
      "18 U.S.C. § 1888 (2018).",
      "The 1988 amendment added 8 subsections.",
    ]) {
      expect(repairSectionSymbols(text), text).toBe(text);
    }
  });

  it("does not fire on text that merely mentions a code", () => {
    const prose = "The U.S.C. is 8 volumes in this library.";
    expect(repairSectionSymbols(prose)).toBe(prose);
  });

  it("repairs every occurrence in a document", () => {
    const damaged = "See 18 U.S.C. §8§ 1544; see also 17 U.S.C. §8§ 103, 107.";
    const repaired = repairSectionSymbols(damaged);
    expect(repaired).not.toContain("8§");
    expect(parse(repaired).citations).toHaveLength(2);
  });

  it.each([
    ["a run of symbols", (n: number) => `18 U.S.C. ${"§8".repeat(n)}1544`],
    // The shape the regex linter caught and the first version of this test
    // missed: two quantifiers competing for the same spaces.
    ["a run of spaces after the code", (n: number) => `18 U.S.C.${" ".repeat(n)}§1544`],
    ["spaces inside the symbol run", (n: number) => `18 U.S.C. §${" ".repeat(n)}§1544`],
  ])("is linear on %s", (_name, attack) => {
    const time = (text: string) => {
      const started = performance.now();
      repairSectionSymbols(text);
      return performance.now() - started;
    };
    // Four times the input. Linear predicts ~4x, quadratic ~16x.
    const small = time(attack(8_000));
    const large = time(attack(32_000));
    expect(large).toBeLessThan(Math.max(small, 1) * 8 + 100);
  });
});

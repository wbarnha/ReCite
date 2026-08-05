/**
 * The engine, graded against a 1L citations quiz.
 *
 * See `fixtures/bluebook-quiz.ts` for provenance and for what each of the two
 * invariants means. The short version: a citation the quiz grades correct must
 * produce no findings, and a citation it grades incorrect must either produce
 * the findings the fixture names or carry a written reason why it does not.
 *
 * The fixtures are checked one document at a time so a failure names the
 * question that broke rather than a line number.
 */

import { describe, expect, it } from "vitest";

import { Engine } from "../src/index.js";
import type { QuizFixture } from "../../core/test/fixtures/bluebook-quiz.js";
import {
  QUIZ_CAUGHT,
  QUIZ_FIXTURES,
  QUIZ_GAPS,
} from "../../core/test/fixtures/bluebook-quiz.js";

/** Fixed so a fixture dated 2026 does not start failing in 2027. */
const engine = () => new Engine({ currentYear: 2026 });

function label(fixture: QuizFixture): string {
  return `Q${fixture.question} ${fixture.id} (${fixture.verdict})`;
}

describe("the fixture file itself", () => {
  it("expects nothing of a citation the quiz grades correct", () => {
    const overreaching = QUIZ_FIXTURES.filter(
      (fixture) =>
        fixture.verdict === "correct" &&
        (fixture.expect.length > 0 || fixture.gap !== undefined),
    );
    expect(overreaching.map(label)).toEqual([]);
  });

  it("explains every wrong answer it does not catch", () => {
    // Exactly one of the two: findings, or a stated reason for silence.
    const unaccounted = QUIZ_FIXTURES.filter(
      (fixture) =>
        fixture.verdict === "incorrect" &&
        fixture.expect.length === 0 &&
        fixture.gap === undefined,
    );
    expect(unaccounted.map(label)).toEqual([]);

    const both = QUIZ_FIXTURES.filter(
      (fixture) => fixture.expect.length > 0 && fixture.gap !== undefined,
    );
    expect(both.map(label)).toEqual([]);
  });

  it("covers all three parts of the quiz", () => {
    const parts = new Set(QUIZ_FIXTURES.map((fixture) => fixture.part));
    expect([...parts].sort()).toEqual(["cases", "secondary", "statutes"]);
  });

  it("keeps a record of what is caught and what is not", () => {
    // These numbers are the point of the file, not incidental. Moving one is
    // fine; moving it silently is not.
    expect(QUIZ_CAUGHT.length).toBe(7);
    expect(QUIZ_GAPS.length).toBe(8);
  });
});

describe("citations the quiz grades correct", () => {
  for (const fixture of QUIZ_FIXTURES.filter((f) => f.verdict === "correct")) {
    it(`${label(fixture)} is clean`, async () => {
      const result = await engine().check(fixture.text);

      // The full messages, not a count: when this fails the message is the
      // thing that says which rule got it wrong.
      expect(
        result.diagnostics.map((d) => `${d.ruleId}: ${d.message}`),
        `${fixture.rule} — ${fixture.why}`,
      ).toEqual([]);
    });
  }
});

describe("citations the quiz grades incorrect", () => {
  for (const fixture of QUIZ_CAUGHT) {
    it(`${label(fixture)} reports ${fixture.expect.join(", ")}`, async () => {
      const result = await engine().check(fixture.text);
      const reported = result.diagnostics.map((d) => d.ruleId);

      for (const ruleId of fixture.expect) {
        expect(
          reported,
          `${fixture.rule} — ${fixture.why}\nreported: ${result.diagnostics
            .map((d) => `${d.ruleId}: ${d.message}`)
            .join("\n          ")}`,
        ).toContain(ruleId);
      }
    });
  }

  for (const fixture of QUIZ_GAPS) {
    it(`${label(fixture)} is missed, on purpose: ${fixture.gap}`, async () => {
      const result = await engine().check(fixture.text);

      // A gap that has quietly closed is good news, but it is still a change
      // to what this file claims — the reason text has to go.
      expect(
        result.diagnostics.map((d) => `${d.ruleId}: ${d.message}`),
        `this now reports something; remove the gap and record what it catches`,
      ).toEqual([]);
    });
  }
});

describe("fixes offered for the quiz's wrong answers", () => {
  it("rewrites the Westlaw court convention to the Seventh Circuit", async () => {
    const fixed = await engine().fix(
      "United States v. Wilson, 502 F.3d 718 (C.A. 7. 2007).",
      { unsafe: true },
    );
    expect(fixed.fixedText).toBe(
      "United States v. Wilson, 502 F.3d 718 (7th Cir. 2007).",
    );
  });

  it("drops a court the reporter already identifies", async () => {
    // Rule 10.4(a). Safe, because the authority does not change — so this one
    // applies without the caller opting in to unsafe fixes.
    const fixed = await engine().fix(
      "Cleveland v. Policy Management Sys. Corp., 526 U.S. 795 (U.S. 1999).",
    );
    expect(fixed.fixedText).toBe(
      "Cleveland v. Policy Management Sys. Corp., 526 U.S. 795 (1999).",
    );
  });

  it("adds the second section symbol", async () => {
    const fixed = await engine().fix("18 U.S.C. § 1544, 1546 (2012).");
    expect(fixed.fixedText).toBe("18 U.S.C. §§ 1544, 1546 (2012).");
  });

  it("does not offer to rewrite a span of sections", async () => {
    // ST007 reports without a correction. `§§ 103-07` could mean 103 to 107
    // or 103 to 1007 depending on how many digits were dropped, and this
    // fixture's own answer key is the only reason we know which — a fix would
    // be guessing.
    const result = await engine().check("17 U.S.C. §§ 103-07 (2012).");
    const finding = result.diagnostics.find((d) => d.ruleId === "ST007");
    expect(finding?.correction).toBeUndefined();
    expect(finding?.message).toContain("103-107");
  });
});

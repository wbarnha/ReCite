/** The rule set, exercised against both synthetic and real citation text. */

import { parse } from "@recite/core";
import type { BluebookProfile, Diagnostic, VerificationResult } from "@recite/core";
import { describe, expect, it } from "vitest";

import {
  allRules,
  ambiguousCourt,
  courtAbbreviation,
  courtDidNotExist,
  databaseOnlyCitation,
  getRule,
  implausibleYear,
  inconsistentReporterStyle,
  makeContext,
  nonPrecedentialDisposition,
  pageRangeFormat,
  pinCiteOutOfRange,
  reversedPageRange,
  reporterCourtMismatch,
  reporterFormat,
  runRules,
  selectRules,
  unknownReporter,
  unresolvedShortForm,
  unverifiedAuthority,
  yearOutsideReporterRange,
} from "../src/index.js";
import type { Rule } from "../src/index.js";

function check(
  text: string,
  rule?: Rule,
  options: {
    verifications?: Map<number, VerificationResult>;
    currentYear?: number;
    profile?: BluebookProfile;
  } = {},
): Diagnostic[] {
  const ctx = makeContext(parse(text), {
    verifications: options.verifications ?? new Map(),
    currentYear: options.currentYear ?? 2026,
    ...(options.profile ? { profile: options.profile } : {}),
  });
  return runRules(ctx, rule ? [rule] : undefined);
}

const ids = (found: Diagnostic[]) => found.map((d) => d.ruleId);

describe("RP001 reporter-format", () => {
  it("reports unspaced Supreme Court Reporter as a style note with a safe fix", () => {
    // Stated explicitly: under the default 21st-edition court-filing profile
    // the closed-up form is permitted, so this test asks for the edition that
    // does require the space.
    const [found] = check("El Al v. Tseng, 119 S.Ct. 662 (1999).", reporterFormat, {
      profile: { edition: 20, style: "practitioner" },
    });
    expect(found?.severity).toBe("info");
    expect(found?.correction?.safety).toBe("safe");
    expect(found?.correction?.replacement).toBe("119 S. Ct. 662");
  });

  it("reports a substantively different abbreviation as a warning", () => {
    const [found] = check("Baz v. Qux, 12 Fed. Rep. 34 (1882).", reporterFormat);
    expect(found?.severity).toBe("warning");
    expect(found?.correction?.replacement).toBe("12 F. 34");
  });

  it("leaves a correctly written citation alone", () => {
    expect(check("Iqbal, 556 U.S. 662 (2009).", reporterFormat)).toEqual([]);
  });

  it("produces a fix that actually yields the canonical text", () => {
    const text = "See 20 L.Ed.2d 835 (1968).";
    const [found] = check(text, reporterFormat, {
      profile: { edition: 20, style: "practitioner" },
    });
    const { span, replacement } = found!.correction!;
    expect(text.slice(0, span.start) + replacement + text.slice(span.end)).toBe(
      "See 20 L. Ed. 2d 835 (1968).",
    );
  });
});

describe("RP002 unknown-reporter", () => {
  it("flags a mistyped reporter with a suggestion", () => {
    const [found] = check(
      "Gamma v. Theta, 12 Cal. Rprt. 3d 45 (2004).",
      unknownReporter,
    );
    expect(found?.severity).toBe("error");
    expect(found?.correction?.replacement).toBe("Cal. Rptr. 3d");
  });

  it("rewrites only the reporter token", () => {
    const text = "Gamma v. Theta, 12 Cal. Rprt. 3d 45 (2004).";
    const [found] = check(text, unknownReporter);
    const { span } = found!.correction!;
    expect(text.slice(span.start, span.end)).toBe("Cal. Rprt. 3d");
  });

  it("does not flag a real citation", () => {
    expect(check("Varghese, 925 F.3d 1339 (11th Cir. 2019).", unknownReporter)).toEqual(
      [],
    );
  });

  it("does not flag a reporter the tables know but the parser skipped", () => {
    // PDF extraction splits citations across lines constantly; a real
    // reporter is not an unknown one.
    expect(check("Iqbal, 556 U. S.\n662, 678 (2009).", unknownReporter)).toEqual([]);
  });

  it("ignores numbers in ordinary prose", () => {
    expect(check("The 12 exhibits span 300 pages.", unknownReporter)).toEqual([]);
  });
});

describe("RP003 inconsistent-reporter-style", () => {
  it("notices one reporter abbreviated two ways", () => {
    // Straight from the filing: `S.Ct.` on one line, `S. Ct.` two lines later.
    const found = check(
      "Tseng, 525 U.S. 155, 161, 119 S.Ct. 662 (1999). Id. at 166, 119 S. Ct. 662.",
      inconsistentReporterStyle,
    );
    expect(ids(found)).toEqual(["RP003"]);
    expect(found[0]?.context?.variants).toEqual(
      expect.arrayContaining(["S.Ct.", "S. Ct."]),
    );
  });

  it("says nothing when the document is consistent", () => {
    expect(
      check(
        "A, 119 S. Ct. 662 (1999). B, 88 S. Ct. 1753 (1968).",
        inconsistentReporterStyle,
      ),
    ).toEqual([]);
  });

  it("reports once per reporter, not once per citation", () => {
    const found = check(
      "A, 119 S.Ct. 1 (1999). B, 88 S. Ct. 2 (1968). C, 90 S.Ct. 3 (1970).",
      inconsistentReporterStyle,
    );
    expect(found).toHaveLength(1);
  });
});

describe("DT001 year-outside-reporter-range", () => {
  it("catches a series that did not exist yet", () => {
    const [found] = check(
      "Delta v. Epsilon, 999 F.3d 1 (2d Cir. 1950).",
      yearOutsideReporterRange,
    );
    expect(found?.severity).toBe("error");
    expect(found?.correction?.replacement).toBe("999 F.2d 1");
    expect(found?.correction?.safety).toBe("unsafe");
  });

  it("catches a series that had already closed", () => {
    // The Federal Supplement ran to 1998; a 2005 case is in the second series.
    const [found] = check(
      "Alpha v. Beta, 700 F. Supp. 1200 (S.D.N.Y. 2005).",
      yearOutsideReporterRange,
    );
    expect(found?.context?.suggestion).toBe("F. Supp. 2d");
  });

  it("accepts a year inside the range", () => {
    expect(
      check("Varghese, 925 F.3d 1339 (11th Cir. 2019).", yearOutsideReporterRange),
    ).toEqual([]);
  });

  it("says nothing without a year", () => {
    expect(
      check("the court cited 925 F.3d 1339 there", yearOutsideReporterRange),
    ).toEqual([]);
  });
});

describe("DT002 implausible-year", () => {
  it("reports a decision from the future", () => {
    const [found] = check(
      "Future v. Thing, 5 F.4th 9 (1st Cir. 2099).",
      implausibleYear,
      {
        currentYear: 2026,
      },
    );
    expect(found?.severity).toBe("error");
    expect(found?.correction).toBeUndefined();
  });

  it("accepts the current year", () => {
    expect(
      check("A v. B, 5 F.4th 9 (1st Cir. 2026).", implausibleYear, {
        currentYear: 2026,
      }),
    ).toEqual([]);
  });
});

describe("CT rules", () => {
  it("CT001 abbreviates a spelled-out court", () => {
    const text = "A v. B, 700 F. Supp. 1 (Southern District of New York 1990).";
    const [found] = check(text, courtAbbreviation);
    expect(found?.correction?.replacement).toBe("S.D.N.Y.");
    const { span } = found!.correction!;
    expect(text.slice(span.start, span.end)).toBe("Southern District of New York");
  });

  it("CT001 leaves a canonical abbreviation alone", () => {
    expect(check("A v. B, 925 F.3d 1339 (11th Cir. 2019).", courtAbbreviation)).toEqual(
      [],
    );
  });

  it("CT001 leaves a non-court parenthetical alone", () => {
    expect(check("A v. B, 1 F.3d 1 (per curiam).", courtAbbreviation)).toEqual([]);
  });

  it("CT002 catches a circuit court in the U.S. Reports", () => {
    const [found] = check(
      "Wrong v. Court, 200 U.S. 1 (9th Cir. 1906).",
      reporterCourtMismatch,
    );
    expect(found?.severity).toBe("error");
    expect(found?.correction).toBeUndefined();
  });

  it("CT002 accepts a Supreme Court citation", () => {
    expect(check("Iqbal, 556 U.S. 662 (2009).", reporterCourtMismatch)).toEqual([]);
  });

  it("CT003 catches a court cited before it existed", () => {
    // The Eleventh Circuit was created in 1981.
    const [found] = check("A v. B, 600 F.2d 1 (11th Cir. 1975).", courtDidNotExist);
    expect(found?.message).toContain("1981");
  });

  it("CT004 reports an abbreviation two courts share", () => {
    const [found] = check(
      "Ehrlich v. American Airlines, Inc., 360 N.J. Super. 360 (App. Div. 2003).",
      ambiguousCourt,
    );
    expect(found?.ruleId).toBe("CT004");
    expect(found?.context?.candidates).toHaveLength(2);
  });
});

describe("ST rules", () => {
  it("ST001 reports a supra with no antecedent", () => {
    const [found] = check("As held in Ghost Corp., supra, at 3.", unresolvedShortForm);
    expect(found?.severity).toBe("error");
  });

  it("ST001 accepts an Id. that follows a full citation", () => {
    expect(
      check("Iqbal, 556 U.S. 662 (2009). Id. at 678.", unresolvedShortForm),
    ).toEqual([]);
  });

  it("ST002 catches a pin cite before the first page", () => {
    const [found] = check("Roe v. Wade, 410 U.S. 113, 99 (1973).", pinCiteOutOfRange);
    expect(found?.context).toMatchObject({ pinCite: 99, firstPage: 113 });
  });

  it("ST002 accepts a pin cite inside the opinion", () => {
    expect(
      check("Miller, 174 F.3d 366, 371-72 (2d Cir. 1999).", pinCiteOutOfRange),
    ).toEqual([]);
  });

  it("ST002 checks a short form against its antecedent", () => {
    const found = check(
      "Zicherman, 516 F.3d 1237 (11th Cir. 2008). See 516 F.3d at 99.",
      pinCiteOutOfRange,
    );
    expect(ids(found)).toContain("ST002");
  });
});

describe("AU rules", () => {
  it("AU001 reports an Illinois Rule 23 order as non-precedential", () => {
    const [found] = check(
      "Shaboon v. Egyptair, 2013 IL App (1st) 111279-U (Ill. App. Ct. 2013).",
      nonPrecedentialDisposition,
    );
    expect(found?.severity).toBe("error");
    expect(found?.context?.reason).toBe("illinois-rule-23");
  });

  it("AU001 reports a Federal Appendix citation as unpublished", () => {
    const [found] = check(
      "A v. B, 100 F. App'x 5 (2d Cir. 2004).",
      nonPrecedentialDisposition,
    );
    expect(found?.severity).toBe("warning");
  });

  it("AU001 accepts a published citation", () => {
    expect(
      check("Varghese, 925 F.3d 1339 (11th Cir. 2019).", nonPrecedentialDisposition),
    ).toEqual([]);
  });

  it("AU002 reports a Westlaw-only citation", () => {
    const [found] = check(
      "Martinez v. Delta Airlines, Inc., 2019 WL 4639462 (Tex. App. Sept. 25, 2019).",
      databaseOnlyCitation,
    );
    expect(found?.ruleId).toBe("AU002");
  });

  it("AU002 accepts a Westlaw number alongside a reporter cite", () => {
    expect(
      check(
        "A v. B, 925 F.3d 1339, 2019 WL 4639462 (11th Cir. 2019).",
        databaseOnlyCitation,
      ),
    ).toEqual([]);
  });
});

describe("VF rules", () => {
  const notFound = (index: number): Map<number, VerificationResult> =>
    new Map([
      [
        index,
        { citationIndex: index, status: "not-found", records: [], source: "test" },
      ],
    ]);

  it("VF001 reports a citation absent from the corpus", () => {
    const [found] = check(
      "Varghese v. China Southern Airlines Co., Ltd., 925 F.3d 1339 (11th Cir. 2019).",
      unverifiedAuthority,
      { verifications: notFound(0) },
    );
    expect(found?.severity).toBe("warning");
    // Worded as absence, never as an accusation of fabrication.
    expect(found?.message).toMatch(/does not appear in the test corpus/);
  });

  it("VF001 is inert without verification results", () => {
    expect(
      check("Varghese, 925 F.3d 1339 (11th Cir. 2019).", unverifiedAuthority),
    ).toEqual([]);
  });
});

describe("registry", () => {
  it("gives every rule a unique id", () => {
    const all = allRules().map((r) => r.id);
    expect(new Set(all).size).toBe(all.length);
  });

  it("finds a rule by id or by name", () => {
    expect(getRule("RP001")).toBe(getRule("reporter-format"));
  });

  it("drops the verification family when running offline", () => {
    const offline = selectRules({ includeVerification: false });
    expect(offline.some((r) => r.requiresVerification)).toBe(false);
    expect(offline.length).toBeLessThan(allRules().length);
  });

  it("narrows to an allow-list", () => {
    expect(selectRules({ enable: ["RP001"] }).map((r) => r.id)).toEqual(["RP001"]);
  });

  it("removes a single rule with the deny-list", () => {
    const remaining = selectRules({ disable: ["RP001"] });
    expect(remaining.map((r) => r.id)).not.toContain("RP001");
    expect(remaining).toHaveLength(allRules().length - 1);
  });

  it("returns findings in document order", () => {
    const found = check(
      "A, 550 US 544 (2007). B, 999 F.3d 1 (2d Cir. 1950). C, 200 U.S. 1 (9th Cir. 1906).",
    );
    const starts = found.map((d) => d.span.start);
    expect(starts).toEqual([...starts].sort((a, b) => a - b));
  });

  it("survives a rule that throws", () => {
    const exploding: Rule = {
      id: "ZZ999",
      name: "exploding",
      summary: "always throws",
      severity: "error",
      check() {
        throw new Error("boom");
      },
    };
    const ctx = makeContext(parse("Iqbal, 556 U.S. 662 (2009)."), {
      currentYear: 2026,
    });
    expect(() => runRules(ctx, [exploding, reporterFormat])).not.toThrow();
  });
});

describe("Bluebook profiles", () => {
  const profiled = (
    text: string,
    profile: { edition: 20 | 21 | 22; style: "practitioner" | "academic" },
  ) =>
    runRules(makeContext(parse(text), { currentYear: 2026, profile }), [
      reporterFormat,
    ]);

  const TIGHTENED = "El Al v. Tseng, 119 S.Ct. 662 (1999).";

  it("accepts a tightened abbreviation in a 21st-edition court filing", () => {
    // The 21st edition lets briefs close up reporter abbreviations to save
    // space, so this is a choice rather than a mistake.
    expect(profiled(TIGHTENED, { edition: 21, style: "practitioner" })).toEqual([]);
  });

  it("accepts it under the 22nd edition too", () => {
    expect(profiled(TIGHTENED, { edition: 22, style: "practitioner" })).toEqual([]);
  });

  it("reports it under the 20th edition", () => {
    const [found] = profiled(TIGHTENED, { edition: 20, style: "practitioner" });
    expect(found?.ruleId).toBe("RP001");
    expect(found?.context?.variant).toBe("tightened");
  });

  it("reports it in scholarly writing whatever the edition", () => {
    expect(profiled(TIGHTENED, { edition: 21, style: "academic" })).toHaveLength(1);
    expect(profiled(TIGHTENED, { edition: 22, style: "academic" })).toHaveLength(1);
  });

  it("names the profile in the message so the reader knows which rule applied", () => {
    const [found] = profiled(TIGHTENED, { edition: 21, style: "academic" });
    expect(found?.message).toContain("scholarly writing");
  });

  it("still reports extra spaces, which no edition permits", () => {
    const [found] = profiled("Roe v. Wade, 410 U. S. 113 (1973).", {
      edition: 22,
      style: "practitioner",
    });
    expect(found?.context?.variant).toBe("loosened");
  });

  it("still reports a substantively different abbreviation", () => {
    const [found] = profiled("Baz v. Qux, 12 Fed. Rep. 34 (1882).", {
      edition: 22,
      style: "practitioner",
    });
    expect(found?.context?.variant).toBe("different");
    expect(found?.severity).toBe("warning");
  });

  it("still reports mixing both spellings, which stays wrong", () => {
    // The edition permits tightening; it does not permit inconsistency.
    const found = runRules(
      makeContext(
        parse("Tseng, 525 U.S. 155, 119 S.Ct. 662 (1999). Id. at 166, 119 S. Ct. 662."),
        { currentYear: 2026, profile: { edition: 21, style: "practitioner" } },
      ),
      [inconsistentReporterStyle],
    );
    expect(ids(found)).toEqual(["RP003"]);
  });

  it("defaults to the 21st edition for court documents", () => {
    // Most people reaching for this are checking a brief.
    expect(check(TIGHTENED, reporterFormat)).toEqual([]);
  });
});

describe("ST003 page-range-format", () => {
  it("reports a range that repeats digits", () => {
    const [found] = check(
      "Miller, 174 F.3d 366, 371-372 (2d Cir. 1999).",
      pageRangeFormat,
    );
    expect(found?.ruleId).toBe("ST003");
    expect(found?.context?.suggestion).toBe("371-72");
  });

  it("reports a four-digit range", () => {
    const [found] = check(
      "A v. B, 1 F.3d 1200, 1204-1208 (2d Cir. 1999).",
      pageRangeFormat,
    );
    expect(found?.context?.suggestion).toBe("1204-08");
  });

  it("accepts a correctly abbreviated range", () => {
    expect(
      check("Miller, 174 F.3d 366, 371-72 (2d Cir. 1999).", pageRangeFormat),
    ).toEqual([]);
  });

  it("accepts a range whose digits do not line up", () => {
    // `98-102` has nothing repetitious to drop.
    expect(check("A v. B, 1 F.3d 90, 98-102 (2d Cir. 1999).", pageRangeFormat)).toEqual(
      [],
    );
  });

  it("says nothing about a single page", () => {
    expect(check("Iqbal, 556 U.S. 662, 678 (2009).", pageRangeFormat)).toEqual([]);
  });
});

describe("ST004 reversed-page-range", () => {
  it("reports a range that runs backwards", () => {
    const [found] = check(
      "A v. B, 1 F.3d 300, 380-371 (2d Cir. 1999).",
      reversedPageRange,
    );
    expect(found?.ruleId).toBe("ST004");
    expect(found?.context).toMatchObject({ from: 380, to: 371 });
  });

  it("accepts a forward range", () => {
    expect(
      check("Miller, 174 F.3d 366, 371-72 (2d Cir. 1999).", reversedPageRange),
    ).toEqual([]);
  });
});

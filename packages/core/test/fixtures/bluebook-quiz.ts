/**
 * Fixtures transcribed from a 1L citations quiz, with its answer key.
 *
 * Source: *Experiential Legal Writing I — Citations Quiz* (review handout,
 * `SBanQuizReviewBluebookCitations1L.pdf`). Twenty questions across cases,
 * statutes and secondary sources; each one gives the correct citation and
 * names the Bluebook rule it comes from. That combination is what makes it
 * worth building tests on. The Mata fixtures next door are a corpus of real
 * citations and answer "does the parser see this?"; the quiz is a corpus of
 * *graded* citations and answers "does ReCite agree with the Bluebook?" —
 * including where the Bluebook says a citation is fine and ReCite must
 * therefore keep quiet.
 *
 * The text was extracted from the PDF with ReCite's own OCR importer, which
 * is why the quiz's typographic apostrophes survive into the strings below.
 *
 * Two invariants, both enforced by the test file:
 *
 * 1. **A citation the quiz grades correct produces no findings.** This is the
 *    stricter half and the reason the fixture exists. A checker that flags
 *    correct work is worse than one that misses errors: the errors were going
 *    to be missed anyway, but a false positive costs a lawyer time and, if
 *    they act on it, breaks a citation that was right. Two of these were live
 *    bugs when the fixture was written — a law review article reported as a
 *    misspelled case reporter, and an unreported case reported as missing its
 *    reporter cite.
 *
 * 2. **A citation the quiz grades incorrect either produces the findings named
 *    in `expect`, or carries a `gap` saying why it does not.** Silence is
 *    allowed; unexplained silence is not. The gaps are the honest part of this
 *    file: ReCite checks the mechanics of a citation, not case names, party
 *    abbreviations, procedural phrases, or whether a better reporter exists —
 *    and roughly half of what a 1L gets wrong is in that second list.
 *
 * Where a question is about a short form, the fixture text carries the
 * antecedent full citation too, because that is the document the rule is
 * actually about.
 */

/** Which part of the quiz a question came from. */
export type QuizPart = "cases" | "statutes" | "secondary";

/** The quiz's grade for this citation. */
export type QuizVerdict = "correct" | "incorrect";

export interface QuizFixture {
  readonly id: string;
  /** Question number in the quiz. */
  readonly question: number;
  readonly part: QuizPart;
  readonly verdict: QuizVerdict;
  /** The Bluebook rule the quiz cites for its answer. */
  readonly rule: string;
  /** What the quiz says, in its own terms. */
  readonly why: string;
  /** The document to check. Includes an antecedent where a short form needs one. */
  readonly text: string;
  /** Rule ids ReCite is expected to report, in any order. */
  readonly expect: readonly string[];
  /**
   * Why ReCite reports nothing about a citation the quiz grades incorrect.
   *
   * Required whenever `verdict` is `"incorrect"` and `expect` is empty, and
   * forbidden otherwise. This is what keeps a coverage regression from
   * looking like a passing test.
   */
  readonly gap?: string;
}

export const QUIZ_FIXTURES: readonly QuizFixture[] = [
  // ------------------------------------------------------------- Part 1 ---
  {
    id: "q1-indiana-supreme-court",
    question: 1,
    part: "cases",
    verdict: "correct",
    rule: "Rule 10.2.1(f); Table 1.3 (Indiana)",
    why: "State as a party is cited `v. State`; N.E.3d with `(Ind. 2015)`.",
    text: "Lee v. State, 43 N.E.3d 1271 (Ind. 2015).",
    expect: [],
  },
  {
    id: "q2-indiana-court-of-appeals",
    question: 2,
    part: "cases",
    verdict: "correct",
    rule: "Table 6; Table 1.3 (Indiana)",
    why: "First party on each side only; General/Insurance/Company abbreviated.",
    text: "GEICO Gen. Ins. Co. v. Coyne, 7 N.E.3d 300 (Ind. Ct. App. 2014).",
    expect: [],
  },
  {
    id: "q3-textual-sentence",
    question: 3,
    part: "cases",
    verdict: "correct",
    rule: "B10.1.1(vi)",
    why: "In a textual sentence only the eight listed words abbreviate, so `General Insurance` stays spelled out while `Co.` does not.",
    text: "GEICO General Insurance Co. v. Coyne, 7 N.E.3d 300 (Ind. Ct. App. 2014).",
    expect: [],
  },
  {
    id: "q4-a-abbreviated-united-states",
    question: 4,
    part: "cases",
    verdict: "incorrect",
    rule: "B10.1.1",
    why: "`United States` as a party is never abbreviated.",
    text: "U.S v. Wilson, 502 F.3d 718 (7th Cir. 2007).",
    expect: [],
    gap: "ReCite checks the citation, not the case name. Party abbreviations are unchecked.",
  },
  {
    id: "q4-b-seventh-circuit",
    question: 4,
    part: "cases",
    verdict: "correct",
    rule: "B10.1.1; Table 1.1",
    why: "The answer: `United States` spelled out, `(7th Cir. 2007)`.",
    text: "United States v. Wilson, 502 F.3d 718 (7th Cir. 2007).",
    expect: [],
  },
  {
    id: "q4-c-westlaw-court-convention",
    question: 4,
    part: "cases",
    verdict: "incorrect",
    rule: "Table 1.1",
    why: "`C.A.7` is a Westlaw convention with nothing to do with the Bluebook; the parenthetical is `(7th Cir. 2007)`.",
    text: "United States v. Wilson, 502 F.3d 718 (C.A. 7. 2007).",
    expect: ["CT001"],
  },
  {
    id: "q4-d-missing-court",
    question: 4,
    part: "cases",
    verdict: "incorrect",
    rule: "Rule 10.4(a)",
    why: "F.3d does not identify a court, so the parenthetical needs one.",
    text: "United States v. Wilson, 502 F.3d 718 (2007).",
    expect: [],
    gap: "No rule requires a court parenthetical yet. It would need to know which reporters identify a court on their own, which the vendored reporter table records only for the Supreme Court.",
  },
  {
    id: "q5-a-wrong-reporter-series",
    question: 5,
    part: "cases",
    verdict: "incorrect",
    rule: "Table 1.1",
    why: "A district court opinion is in F. Supp. 3d; F.3d is the courts of appeals.",
    text: "L.O. ex rel. D.O. v. E. Allen Cty. Sch. Corp., 58 F.3d 882 (N.D. Ind. 2014).",
    expect: [],
    gap: "`CT002` catches a reporter/court contradiction only for Supreme-Court-only reporters, and `N.D. Ind.` is not in ReCite's court table, so there is no court id to contradict.",
  },
  {
    id: "q5-b-wrong-procedural-phrase",
    question: 5,
    part: "cases",
    verdict: "incorrect",
    rule: "B10.1.1(iv)",
    why: "A suit brought by a parent on a child's behalf takes `ex rel.`, not `in re`.",
    text: "L.O. in re D.O. v. E. Allen Cty. Sch. Corp., 58 F. Supp. 3d 882 (N.D. Ind. 2014).",
    expect: [],
    gap: "Procedural phrases are part of the case name, which ReCite does not check.",
  },
  {
    id: "q5-c-federal-supplement",
    question: 5,
    part: "cases",
    verdict: "correct",
    rule: "B10.1.1(iv); Table 1.1",
    why: "The answer: `ex rel.` and F. Supp. 3d with the district court.",
    text: "L.O. ex rel. D.O. v. E. Allen Cty. Sch. Corp., 58 F. Supp. 3d 882 (N.D. Ind. 2014).",
    expect: [],
  },
  {
    id: "q5-d-spelled-out-district",
    question: 5,
    part: "cases",
    verdict: "incorrect",
    rule: "B10.1.1(iv); Table 1.1",
    why: "`in re` again, and `N. Dist. Ind.` is not how the district abbreviates.",
    text: "L.O. in re D.O. v. E. Allen Cty. Sch. Corp., 58 F. Supp. 3d 882 (N. Dist. Ind. 2014).",
    expect: [],
    gap: "`CT006` suggests a standard abbreviation only when it holds one to suggest, and the Northern District of Indiana is not in ReCite's court table.",
  },
  {
    id: "q6-a-official-reporter",
    question: 6,
    part: "cases",
    verdict: "correct",
    rule: "Rule 10.3.1; Rule 10.4(a)",
    why: "The answer: cite U.S. where the case appears there, and the reporter identifies the court, so the parenthetical is the year alone.",
    text: "Cleveland v. Policy Mgmt. Sys. Corp., 526 U.S. 795 (1999).",
    expect: [],
  },
  {
    id: "q6-b-unofficial-reporter",
    question: 6,
    part: "cases",
    verdict: "incorrect",
    rule: "Rule 10.3.1",
    why: "S. Ct. is the unofficial reporter; the case is in U.S., so cite that.",
    text: "Cleveland v. Policy Management Systems Corp., 119 S. Ct. 1597 (1999).",
    expect: [],
    gap: "Knowing that this case is also in U.S. Reports requires a corpus. That is the `VF` family's job, and it is inert without a verification provider.",
  },
  {
    id: "q6-c-redundant-court",
    question: 6,
    part: "cases",
    verdict: "incorrect",
    rule: "Rule 10.4(a)",
    why: "U.S. Reports carry only the Supreme Court, so naming it in the parenthetical is redundant.",
    text: "Cleveland v. Policy Management Sys. Corp., 526 U.S. 795 (U.S. 1999).",
    expect: ["CT005"],
  },
  {
    id: "q7-unreported-westlaw",
    question: 7,
    part: "cases",
    verdict: "correct",
    rule: "B10.1.4(i); Rule 10.8.1(a); Table 6",
    why: "A case not yet in the Federal Reporter is cited by docket number and database identifier, with a star page.",
    text: "Blasius v. Angel Auto., Inc., No. 15-2994, 2016 WL 5929824, at *6 (7th Cir. Oct. 12, 2016).",
    expect: [],
  },
  {
    id: "q8-c-year-in-short-form",
    question: 8,
    part: "cases",
    verdict: "incorrect",
    rule: "B10.2",
    why: "The short form is party, volume, reporter, `at`, page. The date was given in the full citation and is not repeated.",
    text: [
      "Griggs v. State Farm Lloyds, 181 F.3d 694 (5th Cir. 1999).",
      "The court reached the opposite conclusion in Rico v. Flores, 481 F.3d 234 (5th Cir. 2007).",
      "Griggs, 181 F.3d at 700-01 (1999).",
    ].join(" "),
    expect: ["ST005"],
  },
  {
    id: "q8-d-short-form",
    question: 8,
    part: "cases",
    verdict: "correct",
    rule: "B10.2",
    why: "The answer: a full short form is required because another case intervenes.",
    text: [
      "Griggs v. State Farm Lloyds, 181 F.3d 694 (5th Cir. 1999).",
      "The court reached the opposite conclusion in Rico v. Flores, 481 F.3d 234 (5th Cir. 2007).",
      "Griggs, 181 F.3d at 700-01.",
    ].join(" "),
    expect: [],
  },
  {
    id: "q9-a-id-immediately-after",
    question: 9,
    part: "cases",
    verdict: "correct",
    rule: "B10.2",
    why: "The answer: nothing intervenes, so `Id. at 240` is right.",
    text: "Rico v. Flores, 481 F.3d 234, 237 (5th Cir. 2007). Id. at 240.",
    expect: [],
  },
  {
    id: "q10-d-explanatory-parenthetical",
    question: 10,
    part: "cases",
    verdict: "correct",
    rule: "B1.3",
    why: "An explanatory parenthetical opens with a present participle. (The quiz notes its own answer omits the pin cite by mistake; it is restored here.)",
    text: "Fruth v. Lear, 688 A.2d 35, 38 (Pa. 1998) (holding that the defendant breached the contract).",
    expect: [],
  },
  {
    id: "q10-c-past-tense-parenthetical",
    question: 10,
    part: "cases",
    verdict: "incorrect",
    rule: "B1.3",
    why: "`(held that ...)` should be `(holding that ...)`.",
    text: "Fruth v. Lear, 688 A.2d 35, 38 (Pa. 1998) (held that the defendant breached the contract).",
    expect: [],
    gap: "ReCite does not read explanatory parentheticals. Distinguishing a participle from a past tense is a grammar check, not a citation check.",
  },

  // ------------------------------------------------------------- Part 2 ---
  {
    id: "q11-federal-rule",
    question: 11,
    part: "statutes",
    verdict: "correct",
    rule: "B12.1.3",
    why: "Federal rules are cited by name and number, with no year.",
    text: "Fed. R. Civ. P. 12(b)(6).",
    expect: [],
  },
  {
    id: "q12-main-volume-and-supplement",
    question: 12,
    part: "statutes",
    verdict: "correct",
    rule: "Rule 12.3.2; Rule 3.1(c)",
    why: "Material in both the main volume and a supplement cites both.",
    text: "17 U.S.C. § 501 (2012 & Supp. II 2014).",
    expect: [],
  },
  {
    id: "q13-a-two-sections",
    question: 13,
    part: "statutes",
    verdict: "correct",
    rule: "Rule 3.3(b)",
    why: "The answer: two sections, two section symbols, ordinary type, with the year.",
    text: "18 U.S.C. §§ 1544, 1546 (2012).",
    expect: [],
  },
  {
    id: "q13-b-one-section-symbol",
    question: 13,
    part: "statutes",
    verdict: "incorrect",
    rule: "Rule 3.3(b)",
    why: "Two sections behind a single `§`.",
    text: "18 U.S.C. § 1544, 1546 (2012).",
    expect: ["ST006"],
  },
  {
    id: "q13-d-no-year",
    question: 13,
    part: "statutes",
    verdict: "incorrect",
    rule: "Rule 12.3.2",
    why: "A full statute citation carries the year of the code.",
    text: "18 U.S.C. §§ 1544, 1546.",
    expect: [],
    gap: "No rule requires a year parenthetical on a statute. Reporting one would misfire on every short-form statute cite, which correctly omits it (B12.2).",
  },
  {
    id: "q14-c-short-form-after-intervening",
    question: 14,
    part: "statutes",
    verdict: "correct",
    rule: "B12.2; Rule 12.10",
    why: "The answer: with an intervening citation, `Id.` is unavailable, and a statute short form drops the year.",
    text: [
      "The court had jurisdiction under 28 U.S.C. § 1331 (2006).",
      "See Rico v. Flores, 481 F.3d 234 (5th Cir. 2007).",
      "Diversity jurisdiction is governed by § 1332.",
    ].join(" "),
    expect: [],
  },
  {
    id: "q15-b-id-without-at",
    question: 15,
    part: "statutes",
    verdict: "correct",
    rule: "B12.2",
    why: "The answer: `Id. § 1985` — a statute short form takes no `at`.",
    text: "42 U.S.C. § 1983 (2012). Id. § 1985.",
    expect: [],
  },
  {
    id: "q16-a-one-symbol-and-dropped-digits",
    question: 16,
    part: "statutes",
    verdict: "incorrect",
    rule: "Rule 3.3(b)",
    why: "Both errors at once: one section symbol for a span, and digits dropped from its end.",
    text: "17 U.S.C. § 103-07 (2012).",
    expect: ["ST006", "ST007"],
  },
  {
    id: "q16-b-dropped-digits",
    question: 16,
    part: "statutes",
    verdict: "incorrect",
    rule: "Rule 3.3(b)",
    why: "A span of sections keeps every digit — unlike a span of pages, which drops the repetitious ones.",
    text: "17 U.S.C. §§ 103-07 (2012).",
    expect: ["ST007"],
  },
  {
    id: "q16-c-one-section-symbol",
    question: 16,
    part: "statutes",
    verdict: "incorrect",
    rule: "Rule 3.3(b)",
    why: "Digits kept, but a span still needs `§§`.",
    text: "17 U.S.C. § 103-107 (2012).",
    expect: ["ST006"],
  },
  {
    id: "q16-d-section-span",
    question: 16,
    part: "statutes",
    verdict: "correct",
    rule: "Rule 3.3(b)",
    why: "The answer: two section symbols and every digit.",
    text: "17 U.S.C. §§ 103-107 (2012).",
    expect: [],
  },
  {
    id: "q17-state-code",
    question: 17,
    part: "statutes",
    verdict: "correct",
    rule: "Table 1.3 (Indiana)",
    why: "Indiana Code is cited `Ind. Code § x-x-x-x (year)`.",
    text: "Ind. Code § 22-5-3-2 (2012).",
    expect: [],
  },

  // ------------------------------------------------------------- Part 3 ---
  {
    id: "q18-newspaper-article",
    question: 18,
    part: "secondary",
    verdict: "correct",
    rule: "B16.1.4",
    why: "Author, title, paper, date, `at` page.",
    text: "Michael S. Schmidt & Richard Sandomir, Baseball Taking Control of Dodgers’ Operations, N.Y. Times, Apr. 21, 2011, at B2.",
    expect: [],
  },
  {
    id: "q19-law-review-article",
    question: 19,
    part: "secondary",
    verdict: "correct",
    rule: "B16",
    why: "Author, title, volume, journal, first page, year.",
    text: "Charles P. Cercone, The War Against Work Product Abuse: Exposing the Legal Alchemy of Document Compilations As Work Product, 64 U. Pitt. L. Rev. 639 (2003).",
    expect: [],
  },
  {
    id: "q20-book",
    question: 20,
    part: "secondary",
    verdict: "correct",
    rule: "B15",
    why: "Authors, title, page, edition and year in a parenthetical.",
    text: "Elizabeth Fajans & Mary R. Falk, Scholarly Writing for Law Students 25 (4th ed. 2011).",
    expect: [],
  },
];

/** The questions whose wrong answers ReCite is expected to catch. */
export const QUIZ_CAUGHT = QUIZ_FIXTURES.filter(
  (fixture) => fixture.verdict === "incorrect" && fixture.expect.length > 0,
);

/** The wrong answers ReCite knowingly does not catch, each with its reason. */
export const QUIZ_GAPS = QUIZ_FIXTURES.filter((fixture) => fixture.gap !== undefined);

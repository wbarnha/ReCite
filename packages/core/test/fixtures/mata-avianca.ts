/**
 * Regex fixtures transcribed from a real filing.
 *
 * Source: *Mata v. Avianca, Inc.*, No. 1:22-cv-01461-PKC (S.D.N.Y.),
 * Document 21 — "Affirmation in Opposition", filed 03/01/23. A public court
 * record, and an unusually good corpus for this project: it is the filing
 * whose citations turned out to be fabricated, and the ones that are real are
 * typed inconsistently enough to exercise nearly every branch of the parser.
 *
 * Each fixture below is the citation as it appears in the document, with the
 * parse the regexes are expected to produce. Where the PDF's line wrapping
 * changes the input — a pin cite range broken across lines — the fixture keeps
 * the break, because that is what a user pasting from a PDF will hand us.
 *
 * Nothing here asserts whether a cited case exists. That is the `VF` rules'
 * job and needs a corpus; these fixtures are about *parsing*.
 */

import type { CitationKind } from "../../src/model.js";

export interface ExpectedCitation {
  readonly kind: CitationKind;
  readonly text: string;
  readonly volume?: string;
  /** The abbreviation as typed, which is often not the canonical one. */
  readonly reporter?: string;
  readonly reporterCanonical?: string;
  readonly page?: string;
  readonly year?: number;
  readonly courtId?: string;
  readonly courtText?: string;
  readonly caseName?: string;
  readonly pinCite?: string;
  readonly database?: string;
  readonly neutralBody?: string;
  /** Index within the same fixture of the citation this one is parallel to. */
  readonly parallelOf?: number;
}

export interface CitationFixture {
  readonly id: string;
  /** Page of the filing this was transcribed from. */
  readonly page: number;
  /** What the format exercises, and why it is hard. */
  readonly exercises: string;
  readonly text: string;
  readonly expected: readonly ExpectedCitation[];
}

export const MATA_FIXTURES: readonly CitationFixture[] = [
  {
    id: "us-reports-no-court",
    page: 3,
    exercises:
      "U.S. Reports with a bare year parenthetical; the court is implied by the reporter, so there is no court text to resolve.",
    text: "In the case of Ashcroft v. Iqbal, 556 U.S. 662 (2009), the Supreme Court held that when",
    expected: [
      {
        kind: "case-reporter",
        text: "556 U.S. 662",
        volume: "556",
        reporter: "U.S.",
        reporterCanonical: "U.S.",
        page: "662",
        year: 2009,
        caseName: "Ashcroft v. Iqbal",
      },
    ],
  },
  {
    id: "federal-reporter-third-with-circuit",
    page: 3,
    exercises: "F.3d with a numbered circuit; the ordinary case.",
    text: "In Doe v. United States, 419 F.3d 1058 (9th Cir. 2005), the Ninth Circuit held that the",
    expected: [
      {
        kind: "case-reporter",
        text: "419 F.3d 1058",
        volume: "419",
        reporterCanonical: "F.3d",
        page: "1058",
        year: 2005,
        courtId: "ca9",
        courtText: "9th Cir.",
        caseName: "Doe v. United States",
      },
    ],
  },
  {
    id: "neutral-citation-unpublished",
    page: 4,
    exercises:
      "An Illinois public-domain citation with a parenthesised district and a `-U` suffix marking a non-precedential Rule 23 order. No volume, no reporter, no page.",
    text: "In Shaboon v. Egyptair, 2013 IL App (1st) 111279-U (Ill. App. Ct. 2013), the Illinois Appellate Court held",
    expected: [
      {
        kind: "neutral",
        text: "2013 IL App (1st) 111279-U",
        year: 2013,
        neutralBody: "IL App (1st) 111279-U",
        courtId: "illapp",
        courtText: "Ill. App. Ct.",
        caseName: "Shaboon v. Egyptair",
      },
    ],
  },
  {
    id: "multi-word-reporter",
    page: 4,
    exercises:
      "`F. Supp. 2d` — a three-token reporter that must beat the shorter `F. Supp.` in the alternation, or the series number is lost.",
    text: "Similarly, in Peterson v. Iran Air, 905 F. Supp. 2d 121 (D.D.C. 2012), the District Court for",
    expected: [
      {
        kind: "case-reporter",
        text: "905 F. Supp. 2d 121",
        volume: "905",
        reporterCanonical: "F. Supp. 2d",
        page: "121",
        year: 2012,
        courtId: "dcd",
        courtText: "D.D.C.",
        caseName: "Peterson v. Iran Air",
      },
    ],
  },
  {
    id: "ambiguous-court-abbreviation",
    page: 5,
    exercises:
      "`App. Div.` names both New York's and New Jersey's intermediate appellate court. The court must stay unresolved rather than be guessed.",
    text: "In Ehrlich v. American Airlines, Inc., 360 N.J. Super. 360 (App. Div. 2003), the New",
    expected: [
      {
        kind: "case-reporter",
        text: "360 N.J. Super. 360",
        volume: "360",
        reporterCanonical: "N.J. Super.",
        page: "360",
        year: 2003,
        courtText: "App. Div.",
        caseName: "Ehrlich v. American Airlines, Inc.",
      },
    ],
  },
  {
    id: "westlaw-with-month-and-day",
    page: 5,
    exercises:
      "A Westlaw number, plus a parenthetical carrying a court, month, day and year. The month and day must not end up in the court text.",
    text: "In Martinez v. Delta Airlines, Inc., 2019 WL 4639462 (Tex. App. Sept. 25, 2019), the",
    expected: [
      {
        kind: "database",
        text: "2019 WL 4639462",
        year: 2019,
        database: "WL",
        courtId: "texapp",
        courtText: "Tex. App.",
        caseName: "Martinez v. Delta Airlines, Inc.",
      },
    ],
  },
  {
    id: "estate-of-case-name",
    page: 5,
    exercises:
      "A case name beginning `Estate of`, where walking backwards must keep the lowercase particle but drop the sentence connective in front of it.",
    text: "Lastly, in Estate of Durden v. KLM Royal Dutch Airlines, 2017 WL 2418825 (Ga. Ct. App. June 5, 2017).",
    expected: [
      {
        kind: "database",
        text: "2017 WL 2418825",
        year: 2017,
        database: "WL",
        courtId: "gactapp",
        courtText: "Ga. Ct. App.",
        caseName: "Estate of Durden v. KLM Royal Dutch Airlines",
      },
    ],
  },
  {
    id: "corporate-suffixes-in-case-name",
    page: 6,
    exercises:
      "A party name ending `Co., Ltd.` — the commas and the trailing abbreviation must not be mistaken for the end of the name. This is the citation the filing is famous for.",
    text: "the case of Varghese v. China Southern Airlines Co., Ltd., 925 F.3d 1339 (11th Cir. 2019), stating",
    expected: [
      {
        kind: "case-reporter",
        text: "925 F.3d 1339",
        volume: "925",
        reporterCanonical: "F.3d",
        page: "1339",
        year: 2019,
        courtId: "ca11",
        courtText: "11th Cir.",
        caseName: "Varghese v. China Southern Airlines Co., Ltd.",
      },
    ],
  },
  {
    id: "statute-with-subsection",
    page: 6,
    exercises:
      "`11 U.S.C. § 362(a)` — must be recognised as a statute and must not be mis-parsed as a `U.S.` reporter citation with volume 11.",
    text: "commenced before the bankruptcy case was filed. 11 U.S.C. § 362(a). The tolling effect of",
    expected: [
      {
        kind: "statute",
        text: "11 U.S.C. § 362(a)",
        volume: "11",
        page: "362(a)",
      },
    ],
  },
  {
    id: "statute-nested-subsection",
    page: 7,
    exercises: "A statute with two levels of subsection.",
    text: "have been commenced before the bankruptcy case was filed. 11 U.S.C. § 362(a)(1). The",
    expected: [
      {
        kind: "statute",
        text: "11 U.S.C. § 362(a)(1)",
        volume: "11",
        page: "362(a)(1)",
      },
    ],
  },
  {
    id: "parallel-citations-with-pin",
    page: 6,
    exercises:
      "Three reporters for one case, a pin cite after the first, and `L.Ed.2d` written with no spaces. The year in the single trailing parenthetical belongs to all three.",
    text: "law. See Kaiser Steel Corp. v. W.S. Ranch Co., 391 U.S. 593, 598, 88 S. Ct. 1753, 20 L.Ed.2d 835 (1968).",
    expected: [
      {
        kind: "case-reporter",
        text: "391 U.S. 593",
        volume: "391",
        reporterCanonical: "U.S.",
        page: "593",
        pinCite: "598",
        year: 1968,
        caseName: "Kaiser Steel Corp. v. W.S. Ranch Co.",
      },
      {
        kind: "case-reporter",
        text: "88 S. Ct. 1753",
        volume: "88",
        reporter: "S. Ct.",
        reporterCanonical: "S. Ct.",
        page: "1753",
        year: 1968,
        parallelOf: 0,
      },
      {
        kind: "case-reporter",
        text: "20 L.Ed.2d 835",
        volume: "20",
        reporter: "L.Ed.2d",
        reporterCanonical: "L. Ed. 2d",
        page: "835",
        year: 1968,
        parallelOf: 0,
      },
    ],
  },
  {
    id: "pin-cite-then-parenthetical",
    page: 6,
    exercises: "A pin cite sitting between the citation and its parenthetical.",
    text: "Montreal Convention. See Zicherman v. Korean Air Lines Co., Ltd., 516 F.3d 1237, 1254 (11th Cir. 2008), where",
    expected: [
      {
        kind: "case-reporter",
        text: "516 F.3d 1237",
        volume: "516",
        reporterCanonical: "F.3d",
        page: "1237",
        pinCite: "1254",
        year: 2008,
        courtId: "ca11",
        caseName: "Zicherman v. Korean Air Lines Co., Ltd.",
      },
    ],
  },
  {
    id: "unspaced-supreme-court-reporter",
    page: 7,
    exercises:
      "`S.Ct.` and `L.Ed.2d` with no internal spaces, behind a quotation mark that opens the case name.",
    text: 'cargo. "El Al Israel Airlines, Ltd. v. Tseng, 525 U.S. 155, 161, 119 S.Ct. 662, 142 L.Ed.2d 576 (1999). In doing so,',
    expected: [
      {
        kind: "case-reporter",
        text: "525 U.S. 155",
        volume: "525",
        reporterCanonical: "U.S.",
        page: "155",
        pinCite: "161",
        year: 1999,
        caseName: "El Al Israel Airlines, Ltd. v. Tseng",
      },
      {
        kind: "case-reporter",
        text: "119 S.Ct. 662",
        reporter: "S.Ct.",
        reporterCanonical: "S. Ct.",
        year: 1999,
        parallelOf: 0,
      },
      {
        kind: "case-reporter",
        text: "142 L.Ed.2d 576",
        reporter: "L.Ed.2d",
        reporterCanonical: "L. Ed. 2d",
        year: 1999,
        parallelOf: 0,
      },
    ],
  },
  {
    id: "id-with-parallel-cite",
    page: 7,
    exercises:
      "`Id. at 166, 119 S. Ct. 662` — the reporter citation after the comma is a parallel of the `Id.`, not a new authority, and has no case name of its own. Note this spells the reporter `S. Ct.` while page 7 also spells it `S.Ct.`",
    text: "passengers with greater certainty and predictability in the event of an accident. Id. at 166, 119 S. Ct. 662. Allowing the tolling",
    expected: [
      { kind: "id", text: "Id. at 166", pinCite: "166" },
      {
        kind: "case-reporter",
        text: "119 S. Ct. 662",
        reporter: "S. Ct.",
        reporterCanonical: "S. Ct.",
        parallelOf: 0,
      },
    ],
  },
  {
    id: "two-cases-one-sentence",
    page: 8,
    exercises:
      "Two citations joined by a semicolon, the second an `In re` name ending in a state abbreviation. The case name of the second must not swallow the first.",
    text: "limitations under the Warsaw Convention. Miller v. United Airlines, Inc., 174 F.3d 366, 371-72 (2d Cir. 1999); In re Air Crash Disaster Near New Orleans, La., 821 F.2d 1147, 1165 (5th Cir. 1987).",
    expected: [
      {
        kind: "case-reporter",
        text: "174 F.3d 366",
        volume: "174",
        reporterCanonical: "F.3d",
        page: "366",
        pinCite: "371-72",
        year: 1999,
        courtId: "ca2",
        caseName: "Miller v. United Airlines, Inc.",
      },
      {
        kind: "case-reporter",
        text: "821 F.2d 1147",
        volume: "821",
        reporterCanonical: "F.2d",
        page: "1147",
        pinCite: "1165",
        year: 1987,
        courtId: "ca5",
        caseName: "In re Air Crash Disaster Near New Orleans, La.",
      },
    ],
  },
  {
    id: "pin-range-broken-across-lines",
    page: 8,
    exercises:
      "The same citation as it actually appears in the PDF, with the pin cite range split by the line wrap. Anyone pasting from the filing gets this, not the tidy version.",
    text: "limitations under the Warsaw Convention. Miller v. United Airlines, Inc., 174 F.3d 366, 371-\n72 (2d Cir. 1999).",
    expected: [
      {
        kind: "case-reporter",
        text: "174 F.3d 366",
        volume: "174",
        reporterCanonical: "F.3d",
        page: "366",
        pinCite: "371-72",
        year: 1999,
        courtId: "ca2",
        caseName: "Miller v. United Airlines, Inc.",
      },
    ],
  },
  {
    id: "bare-short-reference",
    page: 7,
    exercises:
      "A case referred to by name alone, with no citation. Nothing should be parsed — the parser reports citations, not mentions.",
    text: "The Court in Varghese, relied on their decision in the case of",
    expected: [],
  },
];

/**
 * A continuous excerpt of the argument section, for engine-level tests.
 *
 * Transcribed from pages 3 through 8. Paragraph breaks are preserved; the
 * text between citations is abridged where it carries no citation.
 */
export const MATA_EXCERPT = `ARGUMENT

I. Legal Standard

In the case of Ashcroft v. Iqbal, 556 U.S. 662 (2009), the Supreme Court held that when
evaluating a motion to dismiss, the court must accept all well-pleaded factual allegations as
true. In Doe v. United States, 419 F.3d 1058 (9th Cir. 2005), the Ninth Circuit held that the
court must accept all well-pleaded factual allegations in the complaint as true.

II. State Courts have concurrent jurisdiction

In Shaboon v. Egyptair, 2013 IL App (1st) 111279-U (Ill. App. Ct. 2013), the Illinois Appellate
Court held that state courts have concurrent jurisdiction. Similarly, in Peterson v. Iran Air,
905 F. Supp. 2d 121 (D.D.C. 2012), the District Court for the District of Columbia held the same.
In Ehrlich v. American Airlines, Inc., 360 N.J. Super. 360 (App. Div. 2003), the New Jersey
Appellate Division held that state courts have jurisdiction. In Martinez v. Delta Airlines, Inc.,
2019 WL 4639462 (Tex. App. Sept. 25, 2019), the plaintiff brought a negligence claim. Lastly, in
Estate of Durden v. KLM Royal Dutch Airlines, 2017 WL 2418825 (Ga. Ct. App. June 5, 2017), the
estate of a passenger brought a wrongful death claim.

III. The Statute of Limitations is tolled

The Eleventh Circuit specifically addresses the effect of a bankruptcy stay in the case of
Varghese v. China Southern Airlines Co., Ltd., 925 F.3d 1339 (11th Cir. 2019). The Bankruptcy
Code provides that the filing of a petition operates as a stay. 11 U.S.C. § 362(a). The tolling
effect of the automatic stay is generally a matter of federal law. See Kaiser Steel Corp. v.
W.S. Ranch Co., 391 U.S. 593, 598, 88 S. Ct. 1753, 20 L.Ed.2d 835 (1968). We have previously
held that the automatic stay provisions may toll the statute of limitations under the Warsaw
Convention. See Zicherman v. Korean Air Lines Co., Ltd., 516 F.3d 1237, 1254 (11th Cir. 2008).

Congress enacted the Montreal Convention to modernize and unify the Warsaw Convention system.
El Al Israel Airlines, Ltd. v. Tseng, 525 U.S. 155, 161, 119 S.Ct. 662, 142 L.Ed.2d 576 (1999).
In doing so, Congress sought to provide passengers with greater certainty. Id. at 166, 119 S. Ct.
662. Allowing the tolling of the limitations period furthers this goal.

In the absence of such a provision, we have held that the automatic stay provision may toll the
statute of limitations under the Warsaw Convention. Miller v. United Airlines, Inc., 174 F.3d
366, 371-72 (2d Cir. 1999); In re Air Crash Disaster Near New Orleans, La., 821 F.2d 1147, 1165
(5th Cir. 1987).
`;

/**
 * A minimal authority corpus for exercising the `VF` rules.
 *
 * Contains only the citations from the excerpt that correspond to real,
 * verifiable decisions, so the fixtures can demonstrate what verification adds
 * on top of the format rules. It is a *test fixture*, not a legal reference —
 * absence from it means nothing about the world.
 */
export const DEMO_CORPUS = [
  { key: "556 U.S. 662", caseName: "Ashcroft v. Iqbal", year: 2009, courtId: "scotus" },
  {
    key: "525 U.S. 155",
    caseName: "El Al Israel Airlines, Ltd. v. Tseng",
    year: 1999,
    courtId: "scotus",
  },
  {
    key: "391 U.S. 593",
    caseName: "Kaiser Steel Corp. v. W.S. Ranch Co.",
    year: 1968,
    courtId: "scotus",
  },
  {
    key: "174 F.3d 366",
    caseName: "Miller v. United Airlines, Inc.",
    year: 1999,
    courtId: "ca2",
  },
  {
    key: "821 F.2d 1147",
    caseName: "In re Air Crash Disaster Near New Orleans, La.",
    year: 1987,
    courtId: "ca5",
  },
] as const;

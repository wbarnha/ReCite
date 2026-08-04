/**
 * Reporter reference data.
 *
 * Compiled independently for this project from public sources: reporter names,
 * their standard abbreviations, and the years each series was published are
 * matters of fact about the published record, not anyone's proprietary
 * database. Nothing here is derived from another project's data files.
 *
 * Coverage is United States federal courts plus the regional reporters and the
 * larger state series — enough to check ordinary litigation writing. It is
 * deliberately not exhaustive; `isKnownReporter` returning false means "not in
 * this table", which is why {@link ../rules} treats an unknown reporter as a
 * finding only when it is also a near-miss for a known one.
 *
 * End years are the year the series stopped being published (`null` = current).
 * They are the basis of the strongest offline check ReCite performs: a citation
 * to a series that did not exist in the year given cannot be right.
 */

export type ReporterJurisdiction = "federal" | "regional" | "state";

export interface ReporterEdition {
  /** Canonical Bluebook abbreviation, e.g. `"F. Supp. 2d"`. */
  readonly abbrev: string;
  readonly name: string;
  /** Family key shared by every edition of a series, e.g. `"F."`. */
  readonly series: string;
  readonly start: number;
  readonly end: number | null;
  readonly jurisdiction: ReporterJurisdiction;
  /** Publishes only the Supreme Court of the United States. */
  readonly scotusOnly?: boolean;
  /** Carries dispositions that are not precedential. */
  readonly nonPrecedential?: boolean;
}

export const REPORTERS: readonly ReporterEdition[] = [
  // -- Supreme Court of the United States --------------------------------
  {
    abbrev: "U.S.",
    name: "United States Reports",
    series: "U.S.",
    start: 1790,
    end: null,
    jurisdiction: "federal",
    scotusOnly: true,
  },
  {
    abbrev: "S. Ct.",
    name: "Supreme Court Reporter",
    series: "S. Ct.",
    start: 1882,
    end: null,
    jurisdiction: "federal",
    scotusOnly: true,
  },
  {
    abbrev: "L. Ed.",
    name: "United States Supreme Court Reports, Lawyers' Edition",
    series: "L. Ed.",
    start: 1790,
    end: 1956,
    jurisdiction: "federal",
    scotusOnly: true,
  },
  {
    abbrev: "L. Ed. 2d",
    name: "United States Supreme Court Reports, Lawyers' Edition, Second Series",
    series: "L. Ed.",
    start: 1956,
    end: null,
    jurisdiction: "federal",
    scotusOnly: true,
  },

  // -- Federal courts of appeals -----------------------------------------
  {
    abbrev: "F.",
    name: "Federal Reporter",
    series: "F.",
    start: 1880,
    end: 1924,
    jurisdiction: "federal",
  },
  {
    abbrev: "F.2d",
    name: "Federal Reporter, Second Series",
    series: "F.",
    start: 1924,
    end: 1993,
    jurisdiction: "federal",
  },
  {
    abbrev: "F.3d",
    name: "Federal Reporter, Third Series",
    series: "F.",
    start: 1993,
    end: 2021,
    jurisdiction: "federal",
  },
  {
    abbrev: "F.4th",
    name: "Federal Reporter, Fourth Series",
    series: "F.",
    start: 2021,
    end: null,
    jurisdiction: "federal",
  },
  {
    abbrev: "F. App'x",
    name: "Federal Appendix",
    series: "F. App'x",
    start: 2001,
    end: 2021,
    jurisdiction: "federal",
    nonPrecedential: true,
  },

  // -- Federal district and specialty ------------------------------------
  {
    abbrev: "F. Supp.",
    name: "Federal Supplement",
    series: "F. Supp.",
    start: 1932,
    end: 1998,
    jurisdiction: "federal",
  },
  {
    abbrev: "F. Supp. 2d",
    name: "Federal Supplement, Second Series",
    series: "F. Supp.",
    start: 1998,
    end: 2014,
    jurisdiction: "federal",
  },
  {
    abbrev: "F. Supp. 3d",
    name: "Federal Supplement, Third Series",
    series: "F. Supp.",
    start: 2014,
    end: null,
    jurisdiction: "federal",
  },
  {
    abbrev: "F.R.D.",
    name: "Federal Rules Decisions",
    series: "F.R.D.",
    start: 1938,
    end: null,
    jurisdiction: "federal",
  },
  {
    abbrev: "B.R.",
    name: "West's Bankruptcy Reporter",
    series: "B.R.",
    start: 1979,
    end: null,
    jurisdiction: "federal",
  },
  {
    abbrev: "Fed. Cl.",
    name: "United States Court of Federal Claims Reporter",
    series: "Fed. Cl.",
    start: 1992,
    end: null,
    jurisdiction: "federal",
  },

  // -- Regional reporters -------------------------------------------------
  {
    abbrev: "A.",
    name: "Atlantic Reporter",
    series: "A.",
    start: 1885,
    end: 1938,
    jurisdiction: "regional",
  },
  {
    abbrev: "A.2d",
    name: "Atlantic Reporter, Second Series",
    series: "A.",
    start: 1938,
    end: 2010,
    jurisdiction: "regional",
  },
  {
    abbrev: "A.3d",
    name: "Atlantic Reporter, Third Series",
    series: "A.",
    start: 2010,
    end: null,
    jurisdiction: "regional",
  },
  {
    abbrev: "N.E.",
    name: "North Eastern Reporter",
    series: "N.E.",
    start: 1885,
    end: 1936,
    jurisdiction: "regional",
  },
  {
    abbrev: "N.E.2d",
    name: "North Eastern Reporter, Second Series",
    series: "N.E.",
    start: 1936,
    end: 2014,
    jurisdiction: "regional",
  },
  {
    abbrev: "N.E.3d",
    name: "North Eastern Reporter, Third Series",
    series: "N.E.",
    start: 2014,
    end: null,
    jurisdiction: "regional",
  },
  {
    abbrev: "N.W.",
    name: "North Western Reporter",
    series: "N.W.",
    start: 1879,
    end: 1942,
    jurisdiction: "regional",
  },
  {
    abbrev: "N.W.2d",
    name: "North Western Reporter, Second Series",
    series: "N.W.",
    start: 1942,
    end: null,
    jurisdiction: "regional",
  },
  {
    abbrev: "P.",
    name: "Pacific Reporter",
    series: "P.",
    start: 1883,
    end: 1931,
    jurisdiction: "regional",
  },
  {
    abbrev: "P.2d",
    name: "Pacific Reporter, Second Series",
    series: "P.",
    start: 1931,
    end: 2000,
    jurisdiction: "regional",
  },
  {
    abbrev: "P.3d",
    name: "Pacific Reporter, Third Series",
    series: "P.",
    start: 2000,
    end: null,
    jurisdiction: "regional",
  },
  {
    abbrev: "S.E.",
    name: "South Eastern Reporter",
    series: "S.E.",
    start: 1887,
    end: 1939,
    jurisdiction: "regional",
  },
  {
    abbrev: "S.E.2d",
    name: "South Eastern Reporter, Second Series",
    series: "S.E.",
    start: 1939,
    end: null,
    jurisdiction: "regional",
  },
  {
    abbrev: "So.",
    name: "Southern Reporter",
    series: "So.",
    start: 1887,
    end: 1941,
    jurisdiction: "regional",
  },
  {
    abbrev: "So. 2d",
    name: "Southern Reporter, Second Series",
    series: "So.",
    start: 1941,
    end: 2008,
    jurisdiction: "regional",
  },
  {
    abbrev: "So. 3d",
    name: "Southern Reporter, Third Series",
    series: "So.",
    start: 2008,
    end: null,
    jurisdiction: "regional",
  },
  {
    abbrev: "S.W.",
    name: "South Western Reporter",
    series: "S.W.",
    start: 1886,
    end: 1928,
    jurisdiction: "regional",
  },
  {
    abbrev: "S.W.2d",
    name: "South Western Reporter, Second Series",
    series: "S.W.",
    start: 1928,
    end: 1999,
    jurisdiction: "regional",
  },
  {
    abbrev: "S.W.3d",
    name: "South Western Reporter, Third Series",
    series: "S.W.",
    start: 1999,
    end: null,
    jurisdiction: "regional",
  },

  // -- Selected state reporters ------------------------------------------
  {
    abbrev: "N.Y.S.",
    name: "New York Supplement",
    series: "N.Y.S.",
    start: 1888,
    end: 1937,
    jurisdiction: "state",
  },
  {
    abbrev: "N.Y.S.2d",
    name: "New York Supplement, Second Series",
    series: "N.Y.S.",
    start: 1937,
    end: 2015,
    jurisdiction: "state",
  },
  {
    abbrev: "N.Y.S.3d",
    name: "New York Supplement, Third Series",
    series: "N.Y.S.",
    start: 2015,
    end: null,
    jurisdiction: "state",
  },
  {
    abbrev: "N.Y.2d",
    name: "New York Reports, Second Series",
    series: "N.Y.",
    start: 1956,
    end: 2004,
    jurisdiction: "state",
  },
  {
    abbrev: "N.Y.3d",
    name: "New York Reports, Third Series",
    series: "N.Y.",
    start: 2003,
    end: null,
    jurisdiction: "state",
  },
  {
    abbrev: "A.D.2d",
    name: "New York Appellate Division Reports, Second Series",
    series: "A.D.",
    start: 1955,
    end: 2003,
    jurisdiction: "state",
  },
  {
    abbrev: "A.D.3d",
    name: "New York Appellate Division Reports, Third Series",
    series: "A.D.",
    start: 2003,
    end: null,
    jurisdiction: "state",
  },
  {
    abbrev: "N.J. Super.",
    name: "New Jersey Superior Court Reports",
    series: "N.J. Super.",
    start: 1948,
    end: null,
    jurisdiction: "state",
  },
  {
    abbrev: "N.J.",
    name: "New Jersey Reports",
    series: "N.J.",
    start: 1948,
    end: null,
    jurisdiction: "state",
  },
  {
    abbrev: "Cal. Rptr.",
    name: "West's California Reporter",
    series: "Cal. Rptr.",
    start: 1959,
    end: 1991,
    jurisdiction: "state",
  },
  {
    abbrev: "Cal. Rptr. 2d",
    name: "West's California Reporter, Second Series",
    series: "Cal. Rptr.",
    start: 1991,
    end: 2003,
    jurisdiction: "state",
  },
  {
    abbrev: "Cal. Rptr. 3d",
    name: "West's California Reporter, Third Series",
    series: "Cal. Rptr.",
    start: 2003,
    end: null,
    jurisdiction: "state",
  },
  {
    abbrev: "Ill. 2d",
    name: "Illinois Reports, Second Series",
    series: "Ill.",
    start: 1953,
    end: 2011,
    jurisdiction: "state",
  },
  {
    abbrev: "Ill. App. 3d",
    name: "Illinois Appellate Court Reports, Third Series",
    series: "Ill. App.",
    start: 1971,
    end: 2011,
    jurisdiction: "state",
  },
  {
    abbrev: "Tex.",
    name: "Texas Reports",
    series: "Tex.",
    start: 1846,
    end: 1962,
    jurisdiction: "state",
  },
  {
    abbrev: "Ga. App.",
    name: "Georgia Appeals Reports",
    series: "Ga. App.",
    start: 1907,
    end: null,
    jurisdiction: "state",
  },
];

/**
 * Abbreviations that are recognisably wrong, mapped to what was meant.
 *
 * Purely typographic differences (`S.Ct.` for `S. Ct.`, `U. S.` for `U.S.`)
 * are *not* listed here — the parser matches those directly by treating
 * internal whitespace as optional, and reports them as a formatting note.
 * This table is for abbreviations that are substantively different, which
 * deserve more than a shrug.
 */
export const REPORTER_VARIATIONS: Readonly<Record<string, string>> = {
  "Fed. Rep.": "F.",
  "Fed. Rept.": "F.",
  "Fed. App'x": "F. App'x",
  "Fed. Appx.": "F. App'x",
  "F. Supp.2d": "F. Supp. 2d",
  "Sup. Ct.": "S. Ct.",
  "U.S. Rep.": "U.S.",
  "U.S.R.": "U.S.",
  "Lawyers Ed.": "L. Ed.",
  "L.Ed.2d.": "L. Ed. 2d",
  "Atl.": "A.",
  "Pac.": "P.",
  "N.E. Rep.": "N.E.",
  "Cal. Reptr.": "Cal. Rptr.",
  "Cal. Rprt.": "Cal. Rptr.",
};

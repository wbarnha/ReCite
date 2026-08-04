/**
 * The regular expressions ReCite parses citations with.
 *
 * They are exported separately from the parser so they can be tested — and
 * read — on their own. Every pattern here is built to tolerate the way real
 * filings are typed and the way PDF extraction mangles them: optional spacing
 * inside abbreviations (`S.Ct.` and `S. Ct.`), and line breaks in the middle
 * of a citation.
 */

import { DASH_CLASS } from "./bluebook.js";
import { REPORTERS, REPORTER_VARIATIONS } from "./data/reporters.js";

/**
 * Turn an abbreviation into a pattern that matches however it was spaced.
 *
 * `"S. Ct."` becomes `S\.\s*Ct\.\s*`, which matches `S. Ct.`, `S.Ct.` and
 * `S.  Ct.` alike. This is the single most important behaviour in the file:
 * the *Mata v. Avianca* filing spells the Supreme Court Reporter both ways,
 * sometimes in the same paragraph, and a parser that only accepts one of them
 * silently loses half the citations.
 */
export function flexibleAbbrev(abbrev: string): string {
  let out = "";
  for (const ch of abbrev) {
    if (/\s/.test(ch)) {
      out += "\\s*";
      continue;
    }
    if (ch === "'" || ch === "’") {
      out += "['’]";
      continue;
    }
    out += ch.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    if (ch === ".") out += "\\s*";
  }
  // Collapse runs of `\s*`; they are equivalent and the shorter form avoids
  // needless backtracking on long whitespace.
  return out.replace(/(?:\\s\*)+/g, "\\s*").replace(/\\s\*$/, "");
}

/** Every abbreviation the parser will recognise, canonical and variant. */
export function reporterAlternatives(): string[] {
  const all = [...REPORTERS.map((r) => r.abbrev), ...Object.keys(REPORTER_VARIATIONS)];
  // Longest first, so `F. Supp. 2d` wins over `F. Supp.` and `L. Ed. 2d` over
  // `L. Ed.`. Without this the parser would truncate the longer series.
  return [...new Set(all)].sort((a, b) => b.length - a.length);
}

/** The reporter alternation, as an un-anchored pattern fragment. */
export function reporterAlternation(): string {
  return reporterAlternatives().map(flexibleAbbrev).join("|");
}

/** States that issue court-assigned (public domain) citations. */
const NEUTRAL_JURISDICTIONS = [
  "AK",
  "AR",
  "AZ",
  "CO",
  "IL",
  "LA",
  "ME",
  "MS",
  "MT",
  "ND",
  "NM",
  "NY",
  "OH",
  "OK",
  "PA",
  "SD",
  "TN",
  "UT",
  "VT",
  "WI",
  "WY",
];

const VOLUME = String.raw`(?<volume>\d{1,4})`;
const PAGE = String.raw`(?<page>\d{1,5})`;
const YEAR = String.raw`(?<year>(?:1[5-9]|20)\d{2})`;

/**
 * One page, or a range written with any of the dashes people actually type.
 *
 * See {@link DASH_CLASS}: keyboards produce a hyphen, autocorrect produces an
 * em dash, the Bluebook prints an en dash, and PDF extraction produces figure
 * dashes and non-breaking hyphens. All of them mean the same thing.
 */
const PAGE_OR_RANGE = String.raw`\d{1,6}(?:\s*${DASH_CLASS}\s*\d{1,6})?`;

/**
 * A full pin cite: one or more pages and ranges, or `passim`.
 *
 * Rule 3.2(a) separates non-consecutive pages with commas, so `371-72, 380`
 * is a single pin cite rather than a pin cite followed by something else.
 */
const PIN_BODY = String.raw`(?:${PAGE_OR_RANGE}(?:\s*,\s*${PAGE_OR_RANGE})*|passim)`;

/**
 * Build the pattern set. Exported as a function because each call needs its
 * own `RegExp` objects: `lastIndex` on a `/g/` regex is mutable state, and
 * sharing one across concurrent parses would make matches disappear.
 */
export function buildPatterns() {
  const reporter = reporterAlternation();

  return {
    /** `925 F.3d 1339`, `905 F. Supp. 2d 121`, `20 L.Ed.2d 835` */
    caseReporter: new RegExp(
      String.raw`\b${VOLUME}\s+(?<reporter>${reporter})\s+${PAGE}\b`,
      "g",
    ),

    /** `516 F.3d at 1254`, `516 F.3d at 1254-56` — a short form. */
    shortForm: new RegExp(
      String.raw`\b${VOLUME}\s+(?<reporter>${reporter})\s+at\s+(?<pin>${PAGE_OR_RANGE})`,
      "g",
    ),

    /** `2019 WL 4639462`, `2017 U.S. App. LEXIS 12345` */
    database: new RegExp(
      String.raw`\b${YEAR}\s+(?<db>WL|U\.?\s*S\.?\s*(?:App\.?|Dist\.?)\s*LEXIS|LEXIS)\s+(?<num>\d{1,10})\b`,
      "g",
    ),

    /** `2013 IL App (1st) 111279-U`, `2019 ND 12` */
    neutral: new RegExp(
      String.raw`\b${YEAR}\s+(?<juris>(?:${NEUTRAL_JURISDICTIONS.join("|")})(?:\s+App)?)` +
        String.raw`(?:\s*\((?<div>[^)]{1,12})\))?\s+(?<num>\d{1,8}(?:-[A-Z]{1,2})?)\b`,
      "g",
    ),

    /** `11 U.S.C. § 362(a)(1)` */
    statute: new RegExp(
      String.raw`\b(?<title>\d{1,3})\s+(?<code>U\.\s*S\.\s*C\.|C\.F\.R\.)\s*(?:§§?\s*)?` +
        String.raw`(?<section>\d[\w.]*(?:\([\w]{1,4}\))*)`,
      "g",
    ),

    /** `Id. at 166`, `Id. at 166-68`, `Id.` */
    id: new RegExp(String.raw`\bId\.(?:\s*at\s*(?<pin>${PAGE_OR_RANGE}))?`, "g"),

    /**
     * `supra`. The antecedent name is *not* matched here.
     *
     * An earlier version captured the preceding name with an optional
     * `(?:[A-Z]\w*(?:\s+[A-Z]\w*)*,?\s+)?` prefix. That is quadratic: before
     * every position the engine consumes as many capitalised words as it can,
     * fails to find `supra`, and backtracks through all of them. A document of
     * 16,000 capitalised words took over two seconds and grew fourfold with
     * every doubling — enough to hang the Word task pane on a large brief.
     *
     * Matching the literal alone is linear; the name is recovered afterwards
     * by walking backwards over a bounded window. See `antecedentBefore`.
     */
    supra: /\bsupra\b/g,

    /**
     * A pin cite occupying the whole gap between two citations: `, 598`,
     * `, 371–72`, `, 123, 125, 130`.
     *
     * Anchored at both ends on purpose. The gap before a parallel citation
     * looks similar (`, 88 S. Ct. 1753`), and only requiring the whole gap to
     * be pages keeps the two apart.
     */
    pinCite: new RegExp(String.raw`^\s*,\s*(?<pin>${PIN_BODY})\s*,?\s*$`, "i"),

    /** A pin cite trailing the last citation of a group, before `(court year)`. */
    trailingPinCite: new RegExp(String.raw`^\s*,\s*(?<pin>${PIN_BODY})`, "i"),

    /** The `, ` that joins parallel citations for the same case. */
    parallelJoin: /^\s*,\s*$/,

    /** The court and date parenthetical trailing a citation. */
    parenthetical: /^\s*\(([^()]*)\)/,
  };
}

export type Patterns = ReturnType<typeof buildPatterns>;

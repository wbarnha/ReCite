/**
 * The regular expressions ReCite parses citations with.
 *
 * They are exported separately from the parser so they can be tested — and
 * read — on their own. Every pattern here is built to tolerate the way real
 * filings are typed and the way PDF extraction mangles them.
 *
 * Reporters are matched by *shape* rather than by name — see
 * {@link REPORTER_SHAPE}. That is why there is no longer a `flexibleAbbrev`
 * turning `"S. Ct."` into `S\.\s*Ct\.`: spacing is handled where identity is
 * settled, by `findReporter`, which squashes punctuation and whitespace before
 * looking anything up. One place, for every reporter, instead of a generated
 * pattern per abbreviation.
 */

import { DASH_CLASS } from "./bluebook.js";
import { REPORTERS, REPORTER_VARIATIONS } from "./data/reporters.js";

/** Every abbreviation the parser will recognise, canonical and variant. */
export function reporterAlternatives(): string[] {
  const all = [...REPORTERS.map((r) => r.abbrev), ...Object.keys(REPORTER_VARIATIONS)];
  return [...new Set(all)];
}

/**
 * What a reporter abbreviation looks like, rather than which ones exist.
 *
 * The parser used to hold an alternation of every known abbreviation. That was
 * workable at fifty and is not at three and a half thousand: vendoring
 * `reporters-db` turned it into a 67,000-character regular expression, and the
 * measured effect was exactly what that sounds like — the ReDoS suite caught
 * two patterns going superlinear the moment the data landed.
 *
 * So the shape is matched here and the *identity* is settled afterwards, by
 * looking the captured token up in a hash map. That is faster, it scales to
 * however many reporters upstream adds next, and it is strictly more capable:
 * `findReporter` already ignores spacing, so `S.Ct.` and `S. Ct.` resolve the
 * same way without the pattern having to know both spellings.
 *
 * Over-matching is the accepted cost and is safe by construction — `123 Main
 * Street 45` matches this shape and is discarded when the lookup fails. See
 * `parse.ts`, which does the discarding.
 *
 * Structure: an initial capitalised token, then up to four more separated by
 * spaces, lazily — so `905 F. Supp. 2d 121` grows the reporter until a bare
 * page number can follow, landing on `F. Supp. 2d` rather than stopping at
 * `F.`. Each component ends on a non-space character, so the group cannot
 * compete with the whitespace that follows it.
 */
const REPORTER_CHAR = String.raw`[A-Za-z0-9.'’&()\-]`;
export const REPORTER_SHAPE = String.raw`[A-Z]${REPORTER_CHAR}*(?:[ \t]${REPORTER_CHAR}+){0,4}?`;

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
 * One statutory section: `501`, `362(a)(1)`, `240.10b`, `1.401`.
 *
 * Subsection parentheses are bounded at four characters each, which covers
 * every real one — `(a)`, `(1)`, `(iii)`, `(B)` — and stops the group from
 * running away into an explanatory parenthetical.
 *
 * The body must end in a word character. A section number may contain periods
 * (`240.10b`, `1.401`) but never ends in one, and without this the sentence
 * period in `18 U.S.C. §§ 1544, 1546.` is swallowed into the citation.
 */
const STATUTE_SECTION = String.raw`\d(?:[\w.]*\w)?(?:\(\w{1,4}\))*`;

/**
 * What separates one section from the next in a list or a span.
 *
 * Commas and dashes only. A semicolon looks like a separator but is not one:
 * in a string cite it ends the statute and begins the next authority, and
 * accepting it would let `11 U.S.C. § 362(a); 556 U.S. 662` swallow the case
 * that follows.
 */
const SECTION_SEPARATOR = String.raw`(?:,|${DASH_CLASS})`;

/**
 * Build the pattern set. Exported as a function because each call needs its
 * own `RegExp` objects: `lastIndex` on a `/g/` regex is mutable state, and
 * sharing one across concurrent parses would make matches disappear.
 */
export function buildPatterns() {
  const reporter = REPORTER_SHAPE;

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

    /**
     * `11 U.S.C. § 362(a)(1)`, `18 U.S.C. §§ 1544, 1546`, `17 U.S.C. §§ 103-107`
     *
     * The symbol and the trailing sections are captured, not merely skipped,
     * because rule 3.3(b) is entirely about them: several sections need `§§`
     * rather than `§`, and a span of sections keeps every digit where a span
     * of pages would drop the repetitious ones. Neither error is visible from
     * the first section alone.
     *
     * `more` is bounded at nine repetitions and each one must begin with a
     * literal separator followed by a digit, so there is no way for the engine
     * to try the same characters two ways.
     */
    statute: new RegExp(
      String.raw`\b(?<title>\d{1,3})\s+(?<code>U\.\s*S\.\s*C\.|C\.F\.R\.)\s*(?<symbol>§§?)?\s*` +
        String.raw`(?<section>${STATUTE_SECTION})` +
        String.raw`(?<more>(?:\s*${SECTION_SEPARATOR}\s*${STATUTE_SECTION}){0,9})`,
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

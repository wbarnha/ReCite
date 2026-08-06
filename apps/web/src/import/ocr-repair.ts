/**
 * Repairing the one character OCR cannot be trusted with here.
 *
 * Tesseract misreads the section symbol. On a dense page it reads `§§ 1544`
 * as `§8§ 1544`, inventing a digit between the two symbols; the statute
 * citation is then unrecognisable and vanishes from the report. That is not a
 * cosmetic loss — a citation checker that silently drops every statute in a
 * scanned brief is worse than useless, because the reader has no way to know
 * it happened.
 *
 * It is also, unusually, repairable with certainty. The rule below fires only
 * between a code abbreviation and a section number, and only when the text
 * between them already contains a real `§`. That last condition is what makes
 * it safe: the author demonstrably typed a section symbol, so a digit sitting
 * inside the run is recognition noise rather than content. Digits *outside*
 * such a run — a section number, a title, a year — are never touched.
 *
 * What it deliberately does not do is guess at `18 U.S.C. 88 1544`, where both
 * symbols were read as digits and no `§` survives. There is no way to tell
 * that from a genuine reference to section 88, and inventing a symbol would
 * fabricate a citation rather than recover one. That case stays broken and
 * visible.
 */

/**
 * The codes whose section symbols this repairs.
 *
 * Deliberately only the two the parser recognises. A repair that fired on
 * arbitrary text would be a licence to rewrite digits anywhere.
 */
const CODE = String.raw`U\.?\s?S\.?\s?C\.?|C\.?\s?F\.?\s?R\.?`;

/**
 * A code, then a run of section-symbol-ish glyphs, then a section number.
 *
 * The run must contain at least one real `§` — see the header. Bounded at
 * eight characters so a malformed document cannot make this scan far.
 *
 * All the whitespace belongs to *one* quantifier. An earlier spelling let the
 * code group end in `\s*` and the run begin with `[8\s]*`, which meant two
 * quantifiers competing for the same spaces — polynomial backtracking on a
 * document padded with them. The linearity test below did not catch it
 * because its attack string had no long whitespace runs; the regex linter
 * did.
 */
const DAMAGED_SECTION = new RegExp(
  String.raw`(${CODE})([\s8]*§[§8\s]{0,8})(?=\d)`,
  "g",
);

/**
 * Put the section symbols back.
 *
 * `18 U.S.C. §8§ 1544` becomes `18 U.S.C. §§ 1544`. The count is whatever
 * survived recognition, so a run read as `8§` yields one symbol rather than
 * two — which may then be reported by `ST006` as the wrong number of symbols.
 * That is the right failure: a visible, checkable finding about punctuation
 * beats a statute that silently disappeared.
 */
export function repairSectionSymbols(text: string): string {
  return text.replace(DAMAGED_SECTION, (_match, code: string, run: string) => {
    const symbols = run.replace(/[^§]/g, "");
    // Normalised to the spacing rule 3.3(b) wants, since the run's own
    // spacing is whatever recognition happened to produce.
    return `${code} ${symbols} `;
  });
}

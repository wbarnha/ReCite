/**
 * Telling a law review apart from a mistyped reporter.
 *
 * `64 U. Pitt. L. Rev. 639 (2003)` has exactly the shape of a case citation —
 * volume, abbreviation, page — and `U. Pitt. L. Rev.` is in no reporter table,
 * because it is a journal rather than a reporter. Left alone, the
 * unknown-reporter check reads that as a misspelling and offers to rewrite it
 * to `Pitts L.J.`, a nineteenth-century Pittsburgh case reporter. The citation
 * was correct; the suggestion would break it.
 *
 * That is the worst failure a citation checker has: a confident correction to
 * something that was already right. Briefs cite secondary sources constantly,
 * so it would not be rare either.
 *
 * The predicate below is deliberately narrow. It recognises the handful of
 * shapes that are unambiguously periodical — a `L. Rev.` or `L.J.` tail, a
 * leading `J.`, an interior `J.L.` — and nothing else. Anything it does not
 * recognise is treated as a possible reporter, which is the safe direction:
 * the cost is an occasional suggestion on a journal nobody typed wrong, not a
 * rewrite of a correct cite.
 *
 * A caveat worth stating: reporters-db does contain law-journal *reporters*
 * from the era when journals printed opinions — `Ins. L.J.`, `Pittsb. L. Rev.`,
 * `W.L.J.` — and several of those match this predicate. That is harmless where
 * it is used, because the caller checks the reporter tables first and only
 * asks this question about abbreviations that matched nothing.
 */

/** `Harv. L. Rev.`, `U. Pitt. L. Rev.`, `Colum. L. Rev`, `Cardozo Law Review`. */
const LAW_REVIEW_TAIL = /\b(?:L|Law)\.?\s?(?:Rev|Review)\.?$/;

/** `Yale L.J.`, `Geo. L. J.`, `Ohio St. L.J.` */
const LAW_JOURNAL_TAIL = /\bL\.?\s?J\.?$/;

/** `J. Legal Stud.`, `J. Corp. L.` — a journal named by what it covers. */
const JOURNAL_LEAD = /^J\.\s?[A-Z]/;

/** `Harv. J.L. & Tech.`, `Stan. J. L. Bus. & Fin.` */
const JOURNAL_INFIX = /\bJ\.\s?L\./;

/**
 * Whether an abbreviation names a periodical rather than a case reporter.
 *
 * Ask this only about abbreviations the reporter tables did not recognise.
 * See the note above on why the overlap with historical law-journal reporters
 * does not matter there.
 */
export function looksLikePeriodical(abbrev: string): boolean {
  const text = abbrev.trim();
  if (!text) return false;

  return (
    LAW_REVIEW_TAIL.test(text) ||
    LAW_JOURNAL_TAIL.test(text) ||
    JOURNAL_LEAD.test(text) ||
    JOURNAL_INFIX.test(text)
  );
}

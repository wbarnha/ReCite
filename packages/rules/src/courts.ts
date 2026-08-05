/** Rules about the court parenthetical (the `CT` family). */

import type { Diagnostic } from "@recite/core";
import {
  candidateCourts,
  courtById,
  courtExistedIn,
  courtLifespan,
  findReporter,
  resolveCourt,
  suggestCourts,
} from "@recite/core";

import type { Rule, RuleContext } from "./rule.js";
import { diagnose } from "./rule.js";

/**
 * `(Southern District of New York 1990)` -> `(S.D.N.Y. 1990)`.
 *
 * Only fires when the written form resolves to exactly one court. `(en banc)`,
 * `(per curiam)` and genuinely ambiguous abbreviations resolve to nothing and
 * are left alone.
 */
export const courtAbbreviation: Rule = {
  id: "CT001",
  name: "court-abbreviation",
  summary: "Court is named in a form other than its standard abbreviation.",
  severity: "info",

  check(ctx: RuleContext): Diagnostic[] {
    const found: Diagnostic[] = [];

    for (const citation of ctx.extraction.citations) {
      const written = citation.courtText;
      const at = citation.courtSpan;
      if (!written || !at) continue;

      const court = resolveCourt(written);
      // The Supreme Court is identified by its reporter, not by a
      // parenthetical, so there is nothing to abbreviate.
      if (!court || court.id === "scotus") continue;
      if (court.abbrev === written) continue;

      found.push(
        diagnose(
          courtAbbreviation,
          citation,
          `Court is written ${JSON.stringify(written)}; the standard abbreviation is ${JSON.stringify(court.abbrev)}.`,
          {
            span: at,
            replacement: court.abbrev,
            fixSpan: at,
            safety: "unsafe",
            fixDescription: `Abbreviate the court as ${JSON.stringify(court.abbrev)}`,
            context: { written, courtId: court.id },
          },
        ),
      );
    }

    return found;
  },
};

/**
 * `200 U.S. 1 (9th Cir. 1906)` — the U.S. Reports carry only the Supreme Court.
 *
 * A reporter that publishes exactly one court contradicts any other court in
 * the parenthetical. In practice this means two citations were spliced
 * together, which is a common shape for a fabricated one.
 */
export const reporterCourtMismatch: Rule = {
  id: "CT002",
  name: "reporter-court-mismatch",
  summary: "Court in the parenthetical cannot appear in that reporter.",
  severity: "error",

  check(ctx: RuleContext): Diagnostic[] {
    const found: Diagnostic[] = [];

    for (const citation of ctx.extraction.citations) {
      const canonical = citation.reporterCanonical;
      if (!canonical || !citation.courtId || citation.courtId === "scotus") continue;

      const edition = findReporter(canonical);
      if (!edition?.scotusOnly) continue;

      const court = courtById(citation.courtId);

      found.push(
        diagnose(
          reporterCourtMismatch,
          citation,
          `${JSON.stringify(canonical)} reports only the Supreme Court of the United States, but the parenthetical names ${court?.name ?? citation.courtId}.`,
          { context: { reporter: canonical, courtId: citation.courtId } },
        ),
      );
    }

    return found;
  },
};

/** A court cited for a year before it was created or after it was abolished. */
export const courtDidNotExist: Rule = {
  id: "CT003",
  name: "court-did-not-exist",
  summary: "Court was not sitting in the year given.",
  severity: "warning",

  check(ctx: RuleContext): Diagnostic[] {
    const found: Diagnostic[] = [];

    for (const citation of ctx.extraction.citations) {
      if (!citation.courtId || citation.year === undefined) continue;

      const court = courtById(citation.courtId);
      if (!court || courtExistedIn(court, citation.year)) continue;

      found.push(
        diagnose(
          courtDidNotExist,
          citation,
          `${court.name} existed ${courtLifespan(court)}, so it could not have decided a case in ${citation.year}.`,
          { context: { courtId: court.id, year: citation.year } },
        ),
      );
    }

    return found;
  },
};

/**
 * A court abbreviation that names more than one court.
 *
 * `App. Div.` is both New York's and New Jersey's intermediate appellate
 * court. The reader of a brief cannot tell which was meant, and neither can
 * ReCite — so it says so rather than picking one.
 */
export const ambiguousCourt: Rule = {
  id: "CT004",
  name: "ambiguous-court",
  summary: "Court abbreviation could name more than one court.",
  severity: "info",

  check(ctx: RuleContext): Diagnostic[] {
    const found: Diagnostic[] = [];

    for (const citation of ctx.extraction.citations) {
      const written = citation.courtText;
      const at = citation.courtSpan;
      if (!written || !at || citation.courtId) continue;

      const candidates = candidateCourts(written);
      if (candidates.length < 2) continue;

      found.push(
        diagnose(
          ambiguousCourt,
          citation,
          `${JSON.stringify(written)} could mean ${candidates.map((c) => c.name).join(" or ")}. Name the jurisdiction.`,
          {
            span: at,
            context: { written, candidates: candidates.map((c) => c.id) },
          },
        ),
      );
    }

    return found;
  },
};

/**
 * `526 U.S. 795 (U.S. 1999)` — the reporter has already said which court.
 *
 * Bluebook rule 10.4(a): where the reporter unambiguously identifies the
 * court, the parenthetical carries the year alone. The U.S. Reports carry
 * only the Supreme Court, so naming it again is redundant. Reported as style
 * rather than error, because the citation points at the right case either way.
 *
 * This is the opposite face of `CT002`. There the parenthetical *contradicts*
 * a single-court reporter, which means two citations were spliced together;
 * here it merely repeats it.
 */
export const redundantCourt: Rule = {
  id: "CT005",
  name: "redundant-court",
  summary: "Court is named although the reporter already identifies it.",
  severity: "info",

  check(ctx: RuleContext): Diagnostic[] {
    const found: Diagnostic[] = [];

    for (const citation of ctx.extraction.citations) {
      const canonical = citation.reporterCanonical;
      const at = citation.courtSpan;
      if (!canonical || !at || citation.courtId !== "scotus") continue;

      const edition = findReporter(canonical);
      if (!edition?.scotusOnly) continue;

      found.push(
        diagnose(
          redundantCourt,
          citation,
          `${JSON.stringify(canonical)} reports only the Supreme Court, so rule 10.4(a) leaves the court out: write the year alone.`,
          {
            span: at,
            replacement: "",
            // Take the space after the court with it, or the fix turns
            // `(U.S. 1999)` into `( 1999)`.
            fixSpan: { start: at.start, end: withTrailingSpace(ctx, at.end) },
            safety: "safe",
            fixDescription: "Drop the court from the parenthetical",
            context: { reporter: canonical, written: citation.courtText },
          },
        ),
      );
    }

    return found;
  },
};

/**
 * `(9 Cir. 2007)`, `(S.D. New York 1990)` — a standard abbreviation, spelled
 * out.
 *
 * Fires only when exactly one court's abbreviation is the same abbreviation
 * with a token written out in full, which is how these actually go wrong.
 * Anything vaguer produces no finding: the court table is a curated subset of
 * the federal and state courts, so "this is not in the table" is not evidence
 * that it is not a court, and treating it as evidence would flag most of the
 * judiciary.
 *
 * `CT001` handles the forms the table already records as aliases. This one is
 * for the variants nobody wrote down.
 */
export const nonStandardCourt: Rule = {
  id: "CT006",
  name: "non-standard-court",
  summary: "Court is written as a spelled-out variant of a standard abbreviation.",
  severity: "warning",

  check(ctx: RuleContext): Diagnostic[] {
    const found: Diagnostic[] = [];

    for (const citation of ctx.extraction.citations) {
      const written = citation.courtText;
      const at = citation.courtSpan;
      if (!written || !at || citation.courtId) continue;
      // An abbreviation that names several courts is `CT004`'s problem.
      if (candidateCourts(written).length > 0) continue;

      const suggestions = suggestCourts(written, 2);
      // Two candidates means we cannot say which was meant, and a citation
      // checker that renames a court is worse than one that says nothing.
      if (suggestions.length !== 1) continue;
      const abbrev = suggestions[0]!;

      found.push(
        diagnose(
          nonStandardCourt,
          citation,
          `${JSON.stringify(written)} is not a standard court abbreviation. ${JSON.stringify(abbrev)} is, and is the same abbreviation with a word spelled out.`,
          {
            span: at,
            replacement: abbrev,
            fixSpan: at,
            safety: "unsafe",
            fixDescription: `Abbreviate the court as ${JSON.stringify(abbrev)}`,
            context: { written, suggestion: abbrev },
          },
        ),
      );
    }

    return found;
  },
};

/** Extend an offset over the run of spaces that follows it. */
function withTrailingSpace(ctx: RuleContext, end: number): number {
  const { text } = ctx.extraction;
  let out = end;
  while (out < text.length && (text[out] === " " || text[out] === "\t")) out++;
  return out;
}

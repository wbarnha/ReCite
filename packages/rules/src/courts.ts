/** Rules about the court parenthetical (the `CT` family). */

import type { Diagnostic } from "@recite/core";
import {
  candidateCourts,
  courtById,
  courtExistedIn,
  courtLifespan,
  findReporter,
  resolveCourt,
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

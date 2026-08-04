/** Rules that check the year against reality (the `DT` family). */

import type { Diagnostic } from "@recite/core";
import { coverageLabel, editionsCoveringYear, findReporter } from "@recite/core";

import type { Rule, RuleContext } from "./rule.js";
import { diagnose } from "./rule.js";

/** Before this, nothing in the reporter tables exists; a lower year is a typo. */
const EARLIEST_PLAUSIBLE_YEAR = 1600;

/**
 * `999 F.3d 1 (2d Cir. 1950)` — the Federal Reporter's third series began in
 * 1993.
 *
 * The strongest check ReCite can perform without consulting anything: a
 * reporter series and a date are together enough to prove a citation
 * impossible, with no database and no network.
 */
export const yearOutsideReporterRange: Rule = {
  id: "DT001",
  name: "year-outside-reporter-range",
  summary: "Decision year falls outside the years that reporter was published.",
  severity: "error",

  check(ctx: RuleContext): Diagnostic[] {
    const found: Diagnostic[] = [];

    for (const citation of ctx.extraction.citations) {
      const canonical = citation.reporterCanonical;
      if (!canonical || citation.year === undefined) continue;

      const edition = findReporter(canonical);
      if (!edition) continue;
      if (
        citation.year >= edition.start &&
        (edition.end === null || citation.year <= edition.end)
      ) {
        continue;
      }

      const detail = `${canonical} was published ${coverageLabel(edition)}, but this cites ${citation.year}.`;
      const alternatives = editionsCoveringYear(canonical, citation.year);
      const only = alternatives.length === 1 ? alternatives[0] : undefined;

      if (only) {
        // Often a neighbouring edition of the same series was meant.
        found.push(
          diagnose(
            yearOutsideReporterRange,
            citation,
            `${detail} A ${citation.year} case in this series would be in ${JSON.stringify(only.abbrev)}.`,
            {
              replacement: citation.text.replace(
                citation.reporter ?? canonical,
                only.abbrev,
              ),
              safety: "unsafe",
              fixDescription: `Change the reporter to ${JSON.stringify(only.abbrev)}`,
              context: {
                reporter: canonical,
                year: citation.year,
                suggestion: only.abbrev,
              },
            },
          ),
        );
      } else {
        found.push(
          diagnose(
            yearOutsideReporterRange,
            citation,
            `${detail} Check the volume, the reporter and the year.`,
            { context: { reporter: canonical, year: citation.year } },
          ),
        );
      }
    }

    return found;
  },
};

/** A year that cannot be right on its face — in the future, or medieval. */
export const implausibleYear: Rule = {
  id: "DT002",
  name: "implausible-year",
  summary: "Decision year is in the future or impossibly early.",
  severity: "error",

  check(ctx: RuleContext): Diagnostic[] {
    const found: Diagnostic[] = [];

    for (const citation of ctx.extraction.citations) {
      if (citation.year === undefined) continue;

      if (citation.year > ctx.currentYear) {
        found.push(
          diagnose(
            implausibleYear,
            citation,
            `Cites a decision dated ${citation.year}, which is in the future (this year is ${ctx.currentYear}).`,
            { context: { year: citation.year } },
          ),
        );
      } else if (citation.year < EARLIEST_PLAUSIBLE_YEAR) {
        found.push(
          diagnose(
            implausibleYear,
            citation,
            `Decision year ${citation.year} predates any reporter in the tables — likely a typo.`,
            { severity: "warning", context: { year: citation.year } },
          ),
        );
      }
    }

    return found;
  },
};

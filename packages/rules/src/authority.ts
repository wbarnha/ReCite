/**
 * Rules about the weight of what is being cited (the `AU` family).
 *
 * These do not say a citation is malformed. They say it may not carry the
 * authority the sentence around it claims — which is a different, and often
 * more consequential, kind of mistake.
 */

import type { Diagnostic } from "@recite/core";
import { findReporter } from "@recite/core";

import type { Rule, RuleContext } from "./rule.js";
import { diagnose } from "./rule.js";

/**
 * A disposition that is not precedent.
 *
 * Illinois marks Rule 23 orders with a `-U` suffix on the public-domain
 * citation, and they may not be cited as precedent at all. The Federal
 * Appendix collects unpublished federal dispositions, which are citable but
 * not binding. Either way the reader should know before relying on it.
 */
export const nonPrecedentialDisposition: Rule = {
  id: "AU001",
  name: "non-precedential-disposition",
  summary: "Cites an unpublished or non-precedential disposition.",
  severity: "warning",

  check(ctx: RuleContext): Diagnostic[] {
    const found: Diagnostic[] = [];

    for (const citation of ctx.extraction.citations) {
      if (citation.kind === "neutral" && /-U\b/.test(citation.neutralBody ?? "")) {
        found.push(
          diagnose(
            nonPrecedentialDisposition,
            citation,
            `${JSON.stringify(citation.text)} is an unpublished order — the "-U" suffix marks a disposition that is not precedential and generally may not be cited as authority.`,
            { severity: "error", context: { reason: "illinois-rule-23" } },
          ),
        );
        continue;
      }

      const edition = citation.reporterCanonical
        ? findReporter(citation.reporterCanonical)
        : undefined;
      if (edition?.nonPrecedential) {
        found.push(
          diagnose(
            nonPrecedentialDisposition,
            citation,
            `${edition.name} collects unpublished dispositions; ${JSON.stringify(citation.text)} is persuasive at best, not binding.`,
            { context: { reason: "unpublished-reporter", reporter: edition.abbrev } },
          ),
        );
      }
    }

    return found;
  },
};

/**
 * A case cited only by its commercial database number.
 *
 * `2019 WL 4639462` identifies a document in one vendor's system. It carries
 * no court, no volume and no page, so a reader without that subscription
 * cannot find it and cannot tell whether it was ever published. When a case
 * has a reporter citation, the Bluebook wants that one.
 *
 * Two things answer the objection and silence this rule: a parallel reporter
 * citation, and a docket number. The docket number matters because a case
 * genuinely not yet in the reporters is cited by docket number *and* database
 * identifier under rule 10.8.1(a) — `No. 15-2994, 2016 WL 5929824, at *6` is
 * the correct form, not a citation missing its reporter, and complaining
 * about it would be complaining that an unreported case is unreported.
 */
export const databaseOnlyCitation: Rule = {
  id: "AU002",
  name: "database-only-citation",
  summary: "Case is cited only by a commercial database number.",
  severity: "warning",

  check(ctx: RuleContext): Diagnostic[] {
    const found: Diagnostic[] = [];

    for (const citation of ctx.extraction.citations) {
      if (citation.kind !== "database") continue;

      // A parallel reporter citation alongside it answers the objection.
      const hasParallel = ctx.extraction.citations.some(
        (other) =>
          other.kind === "case-reporter" &&
          other.fullSpan.start < citation.fullSpan.end &&
          citation.fullSpan.start < other.fullSpan.end,
      );
      if (hasParallel) continue;

      // The docket number is how rule 10.8.1(a) says a case is unreported.
      if (docketNumberBefore(ctx.extraction.text, citation.fullSpan.start)) continue;

      found.push(
        diagnose(
          databaseOnlyCitation,
          citation,
          `${JSON.stringify(citation.text)} is a ${citation.database} database number with no reporter citation. Add the reporter cite, or say the case is unreported.`,
          { context: { database: citation.database } },
        ),
      );
    }

    return found;
  },
};

/**
 * `No. 15-2994, ` immediately in front of a citation.
 *
 * Anchored at the end and applied to a bounded window, so the cost does not
 * depend on how long the sentence in front of the citation happens to be.
 */
const DOCKET_NUMBER = /\bNos?\.\s{0,4}[\w:-]{2,24}\s{0,4},?\s{0,4}$/;

/** How far back to look. Long enough for `No. 1:22-cv-01461-PKC, `. */
const DOCKET_WINDOW = 48;

function docketNumberBefore(text: string, start: number): boolean {
  return DOCKET_NUMBER.test(text.slice(Math.max(0, start - DOCKET_WINDOW), start));
}

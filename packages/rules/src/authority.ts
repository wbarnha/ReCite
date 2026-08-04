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

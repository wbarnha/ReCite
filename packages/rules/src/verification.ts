/**
 * Rules that compare a citation against a record of real authorities
 * (the `VF` family).
 *
 * Inert unless a {@link @recite/core!VerificationProvider} supplied results.
 * This is the family that catches a citation whose formatting is impeccable
 * and which simply does not exist — the failure mode every other rule here is
 * blind to.
 *
 * Findings are worded as "not in the corpus", never "fabricated". A corpus is
 * only as complete as whoever assembled it, and a tool that cries fraud over
 * its own gaps would be worse than useless.
 */

import type { Diagnostic } from "@recite/core";
import { isFullCitation } from "@recite/core";

import type { Rule, RuleContext } from "./rule.js";
import { diagnose } from "./rule.js";

/** Words carrying no identifying weight when comparing two case names. */
const NOISE = new Set([
  "and",
  "co",
  "coop",
  "corp",
  "inc",
  "llc",
  "llp",
  "ltd",
  "of",
  "the",
  "v",
  "airlines",
  "airways",
  "air",
  "company",
  "incorporated",
  "limited",
]);

function significantWords(name: string): Set<string> {
  return new Set(
    name
      .toLowerCase()
      .split(/[^a-z0-9]+/)
      .filter((w) => w.length > 1 && !NOISE.has(w)),
  );
}

/** Jaccard overlap of the significant words in two case names. */
function similarity(left: string, right: string): number {
  const a = significantWords(left);
  const b = significantWords(right);
  if (a.size === 0 || b.size === 0) return 1; // nothing to compare; do not accuse

  let shared = 0;
  for (const word of a) if (b.has(word)) shared++;
  return shared / (a.size + b.size - shared);
}

/**
 * The citation is well-formed but absent from the reference corpus.
 *
 * Severity is a warning rather than an error on purpose: absence from a corpus
 * is a reason to check, not a finding of fact.
 */
export const unverifiedAuthority: Rule = {
  id: "VF001",
  name: "unverified-authority",
  summary: "Citation is absent from the configured authority corpus.",
  severity: "warning",
  requiresVerification: true,

  check(ctx: RuleContext): Diagnostic[] {
    const found: Diagnostic[] = [];

    for (const citation of ctx.extraction.citations) {
      const result = ctx.verifications.get(citation.index);
      if (!result || result.status !== "not-found") continue;

      found.push(
        diagnose(
          unverifiedAuthority,
          citation,
          `${JSON.stringify(citation.text)} does not appear in the ${result.source} corpus. Verify this authority exists before relying on it.`,
          { context: { source: result.source } },
        ),
      );
    }

    return found;
  },
};

/** The citation matches several authorities and picks out none of them. */
export const ambiguousAuthority: Rule = {
  id: "VF002",
  name: "ambiguous-authority",
  summary: "Citation matches more than one authority in the corpus.",
  severity: "warning",
  requiresVerification: true,

  check(ctx: RuleContext): Diagnostic[] {
    const found: Diagnostic[] = [];

    for (const citation of ctx.extraction.citations) {
      const result = ctx.verifications.get(citation.index);
      if (!result || result.status !== "ambiguous") continue;

      const names = result.records.map((r) => r.caseName);
      found.push(
        diagnose(
          ambiguousAuthority,
          citation,
          `${JSON.stringify(citation.text)} matches several authorities: ${names.slice(0, 3).join("; ")}. Add a court or year to disambiguate.`,
          { context: { candidates: names } },
        ),
      );
    }

    return found;
  },
};

/**
 * The citation is real, but belongs to a different case than the one named.
 *
 * A plausible case name bolted onto a real volume and page. Comparison is by
 * significant-word overlap rather than string equality, so
 * `Bell Atl. Corp. v. Twombly` and `Bell Atlantic Corporation v. Twombly` are
 * recognised as the same case.
 */
export const caseNameMismatch: Rule = {
  id: "VF003",
  name: "case-name-mismatch",
  summary: "Cited case name does not match the authority at that citation.",
  severity: "error",
  requiresVerification: true,

  check(ctx: RuleContext): Diagnostic[] {
    const threshold = 0.34;
    const found: Diagnostic[] = [];

    for (const citation of ctx.extraction.citations) {
      const result = ctx.verifications.get(citation.index);
      const cited = citation.caseName;
      if (!result || result.status !== "found" || !cited) continue;
      if (!isFullCitation(citation)) continue;

      const record = result.records[0];
      if (!record) continue;
      if (similarity(cited, record.caseName) >= threshold) continue;

      found.push(
        diagnose(
          caseNameMismatch,
          citation,
          `${JSON.stringify(citation.text)} is ${JSON.stringify(record.caseName)}, not ${JSON.stringify(cited)}.`,
          {
            context: { cited, actual: record.caseName, url: record.url },
          },
        ),
      );
    }

    return found;
  },
};

/**
 * The authority exists but was decided in a different year than cited.
 *
 * Deliberately offers no fix even though the right year is known: a year that
 * disagrees with the record is usually a symptom of a larger error — the wrong
 * volume, or two cases conflated — and rewriting it would make the citation
 * look verified while leaving the real problem in place.
 */
export const yearMismatch: Rule = {
  id: "VF004",
  name: "year-mismatch",
  summary: "Decision year disagrees with the authority corpus.",
  severity: "warning",
  requiresVerification: true,

  check(ctx: RuleContext): Diagnostic[] {
    const found: Diagnostic[] = [];

    for (const citation of ctx.extraction.citations) {
      const result = ctx.verifications.get(citation.index);
      if (!result || result.status !== "found" || citation.year === undefined) continue;

      const record = result.records[0];
      if (!record?.year || record.year === citation.year) continue;

      found.push(
        diagnose(
          yearMismatch,
          citation,
          `Cited as ${citation.year}, but the corpus dates ${record.caseName} to ${record.year}.`,
          { context: { cited: citation.year, actual: record.year } },
        ),
      );
    }

    return found;
  },
};

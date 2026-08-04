/** Rules about the reporter abbreviation itself (the `RP` family). */

import type { Diagnostic } from "@recite/core";
import {
  allowsTightenedAbbreviations,
  canonicalForVariation,
  describeProfile,
  differsOnlyCosmetically,
  findReporter,
  isKnownReporter,
  spacingVariant,
  squash,
  suggestReporters,
} from "@recite/core";

import type { Rule, RuleContext } from "./rule.js";
import { diagnose } from "./rule.js";

/**
 * `119 S.Ct. 662` -> `119 S. Ct. 662`; `12 Fed. Rep. 34` -> `12 F. 34`.
 *
 * Reported as a note when only the spacing differs and as a warning when a
 * substantively different abbreviation was used, because those deserve
 * different amounts of the reader's attention.
 */
export const reporterFormat: Rule = {
  id: "RP001",
  name: "reporter-format",
  summary: "Reporter abbreviation is misspaced or uses a non-standard variant.",
  severity: "info",

  check(ctx: RuleContext): Diagnostic[] {
    const found: Diagnostic[] = [];

    const tighteningAllowed = allowsTightenedAbbreviations(ctx.profile);

    for (const citation of ctx.extraction.citations) {
      const written = citation.reporter;
      const canonical = citation.reporterCanonical;
      if (!written || !canonical || written === canonical) continue;

      const variant = spacingVariant(written, canonical);

      // The 21st edition lets court filings close up reporter abbreviations to
      // save space, so `119 S.Ct. 662` is a legitimate choice there — not an
      // error to be corrected. Adding spaces was never permitted, and a
      // different abbreviation is a different question entirely.
      if (variant === "tightened" && tighteningAllowed) continue;

      const corrected = citation.text.replace(written, canonical);
      const cosmetic = differsOnlyCosmetically(written, canonical);

      const message =
        variant === "different"
          ? `${JSON.stringify(written)} is a non-standard abbreviation for ${JSON.stringify(canonical)}.`
          : variant === "tightened"
            ? `${JSON.stringify(written)} closes up ${JSON.stringify(canonical)}. ${describeProfile(ctx.profile)} keeps the space.`
            : `${JSON.stringify(citation.text)} should be written ${JSON.stringify(corrected)} — spacing does not match the standard form.`;

      found.push(
        diagnose(reporterFormat, citation, message, {
          severity: cosmetic ? "info" : "warning",
          // Only the spelling changes; the authority is identical.
          replacement: corrected,
          safety: "safe",
          fixDescription: `Normalise to ${JSON.stringify(corrected)}`,
          context: { written, canonical, variant, profile: ctx.profile },
        }),
      );
    }

    return found;
  },
};

/**
 * A reporter abbreviation in no reporter table, close to one that is.
 *
 * The parser only matches abbreviations it knows, so a mistyped reporter
 * produces no citation at all — the error is invisible rather than reported.
 * This rule scans for citation-shaped text the parser did not claim and
 * speaks up only when the token is a near-miss for a real abbreviation, which
 * keeps ordinary numbers in prose from being mistaken for citations.
 */
export const unknownReporter: Rule = {
  id: "RP002",
  name: "unknown-reporter",
  summary: "Text looks like a citation but names no known reporter.",
  severity: "error",

  check(ctx: RuleContext): Diagnostic[] {
    const { text, citations } = ctx.extraction;
    const found: Diagnostic[] = [];

    const shape =
      /\b\d{1,4}\s+(?<reporter>[A-Z][A-Za-z.'’ ]{0,22}?\.(?:\s?\d?(?:d|th|st|rd))?)\s+\d{1,5}\b/g;

    // Both the matches and the citations run in document order, so a single
    // moving pointer answers "is this already claimed?" in linear time.
    // Re-scanning every citation per match is quadratic, and a brief with a
    // few thousand citations is not unusual.
    const claimedSpans = [...citations]
      .map((c) => c.span)
      .sort((a, b) => a.start - b.start);
    let cursor = 0;

    let match: RegExpExecArray | null;
    while ((match = shape.exec(text)) !== null) {
      const start = match.index;
      const end = start + match[0].length;

      while (cursor < claimedSpans.length && claimedSpans[cursor]!.end <= start)
        cursor++;

      let claimed = false;
      for (let i = cursor; i < claimedSpans.length; i++) {
        const span = claimedSpans[i]!;
        if (span.start >= end) break;
        if (span.start < end && start < span.end) {
          claimed = true;
          break;
        }
      }
      if (claimed) continue;

      const token = match.groups?.reporter?.trim();
      if (!token) continue;
      // A reporter the table knows but the parser skipped is almost always a
      // citation broken across lines by a PDF extractor — annoying, but
      // emphatically not an unknown reporter.
      if (isKnownReporter(token) || canonicalForVariation(token)) continue;

      const suggestions = suggestReporters(token);
      const best = suggestions[0];
      if (!best) continue;

      const alternatives =
        suggestions.length > 1
          ? ` (or ${suggestions
              .slice(1)
              .map((s) => JSON.stringify(s))
              .join(", ")})`
          : "";

      const reporterStart = start + match[0].indexOf(token);

      found.push({
        ruleId: unknownReporter.id,
        severity: unknownReporter.severity,
        message: `${JSON.stringify(token)} is not a known reporter. Did you mean ${JSON.stringify(best)}${alternatives}?`,
        span: { start, end },
        citationText: match[0],
        // Rewrite only the reporter token, leaving volume and page alone.
        correction: {
          span: { start: reporterStart, end: reporterStart + token.length },
          replacement: best,
          safety: "unsafe",
          description: `Replace ${JSON.stringify(token)} with ${JSON.stringify(best)}`,
        },
        context: { token, suggestions },
      });
    }

    return found;
  },
};

/**
 * The same reporter abbreviated two different ways in one document.
 *
 * Not a defect in any single citation, which is why the per-citation rules
 * miss it — but a brief that says both `119 S.Ct. 662` and `119 S. Ct. 662`
 * has been assembled from more than one source, and that is worth knowing
 * before anything else in it is trusted.
 */
export const inconsistentReporterStyle: Rule = {
  id: "RP003",
  name: "inconsistent-reporter-style",
  summary: "One reporter is abbreviated inconsistently across the document.",
  severity: "warning",

  check(ctx: RuleContext): Diagnostic[] {
    // Group the spellings actually used, per reporter.
    const spellings = new Map<string, Map<string, number[]>>();

    for (const citation of ctx.extraction.citations) {
      const written = citation.reporter;
      const canonical = citation.reporterCanonical;
      if (!written || !canonical) continue;
      if (!findReporter(canonical)) continue;

      const perReporter = spellings.get(canonical) ?? new Map<string, number[]>();
      const uses = perReporter.get(written) ?? [];
      uses.push(citation.index);
      perReporter.set(written, uses);
      spellings.set(canonical, perReporter);
    }

    const found: Diagnostic[] = [];

    for (const [canonical, perReporter] of spellings) {
      if (perReporter.size < 2) continue;

      const variants = [...perReporter.keys()];
      // Report once, on the first citation that is not already canonical, so
      // a document with fifty citations does not produce fifty findings.
      const offending =
        variants.find((v) => squash(v) !== squash(canonical) || v !== canonical) ??
        variants[0];
      const indexes = perReporter.get(offending ?? "") ?? [];
      const first = indexes[0];
      if (first === undefined) continue;

      const citation = ctx.extraction.citations[first];
      if (!citation) continue;

      found.push(
        diagnose(
          inconsistentReporterStyle,
          citation,
          `${JSON.stringify(canonical)} is abbreviated ${perReporter.size} different ways in this document (${variants.map((v) => JSON.stringify(v)).join(", ")}). Pick one.`,
          { context: { canonical, variants } },
        ),
      );
    }

    return found;
  },
};

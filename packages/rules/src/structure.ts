/** Rules about how citations hang together in a document (the `ST` family). */

import type { Diagnostic, ParsedCitation } from "@recite/core";
import { abbreviateRange, isShortForm, parsePinCite } from "@recite/core";

import type { Rule, RuleContext } from "./rule.js";
import { diagnose } from "./rule.js";

const SHORT_FORM_LABEL: Record<string, string> = {
  id: "An `Id.` citation",
  supra: "A `supra` citation",
  "short-form": "A short-form citation",
};

/**
 * `Id. at 45` with no full citation before it to attach to.
 *
 * Short forms are the easiest thing to break while editing: move a paragraph
 * and the `Id.` that opened it now points at the wrong case, or at nothing.
 */
export const unresolvedShortForm: Rule = {
  id: "ST001",
  name: "unresolved-short-form",
  summary: "Short-form citation has no antecedent full citation.",
  severity: "error",

  check(ctx: RuleContext): Diagnostic[] {
    const found: Diagnostic[] = [];

    for (const citation of ctx.extraction.citations) {
      if (!isShortForm(citation) || citation.resourceKey) continue;

      const label = SHORT_FORM_LABEL[citation.kind] ?? "A short-form citation";
      const hint = citation.caseName
        ? ` It appears to refer to ${JSON.stringify(citation.caseName)}, which is not cited in full anywhere earlier.`
        : " Cite the authority in full the first time it appears.";

      found.push(
        diagnose(
          unresolvedShortForm,
          citation,
          `${label} (${JSON.stringify(citation.text)}) does not follow any full citation.${hint}`,
          { context: { kind: citation.kind, antecedent: citation.caseName } },
        ),
      );
    }

    return found;
  },
};

/**
 * A pin cite that precedes the page the opinion starts on.
 *
 * `410 U.S. 113, 99` cannot be right: page 99 comes before the case does.
 * Only the lower bound is checkable without a database — where an opinion
 * *ends* is not knowable offline — but transposed digits usually trip this.
 */
export const pinCiteOutOfRange: Rule = {
  id: "ST002",
  name: "pin-cite-out-of-range",
  summary: "Pin cite points at a page before the opinion begins.",
  severity: "warning",

  check(ctx: RuleContext): Diagnostic[] {
    const found: Diagnostic[] = [];

    for (const citation of ctx.extraction.citations) {
      const pin = firstNumber(citation.pinCite);
      if (pin === undefined) continue;

      const firstPage = startingPage(ctx, citation);
      if (firstPage === undefined || pin >= firstPage) continue;

      found.push(
        diagnose(
          pinCiteOutOfRange,
          citation,
          `Pin cite ${pin} is before page ${firstPage}, where the opinion starts.`,
          { context: { pinCite: pin, firstPage } },
        ),
      );
    }

    return found;
  },
};

/**
 * A page range whose second number is written out in full.
 *
 * Bluebook rule 3.2(a): drop repetitious digits from the second number but
 * always keep the last two, so `371-372` should read `371-72` and
 * `1204-1208` should read `1204-08`. `98-102` is left alone — the digits do
 * not line up, so nothing is repetitious.
 */
export const pageRangeFormat: Rule = {
  id: "ST003",
  name: "page-range-format",
  summary: "Page range repeats digits the Bluebook drops.",
  severity: "info",

  check(ctx: RuleContext): Diagnostic[] {
    const found: Diagnostic[] = [];

    for (const citation of ctx.extraction.citations) {
      const pin = parsePinCite(citation.pinCite);
      if (!pin) continue;

      for (const range of pin.ranges) {
        // Compare against what the author actually typed. `range.to` is the
        // expanded value and is identical for `371-72` and `371-372`, so it
        // cannot answer this on its own.
        const abbreviated = abbreviateRange(range.from, range.to);
        if (abbreviated === range.writtenTo) continue;

        found.push(
          diagnose(
            pageRangeFormat,
            citation,
            `Page range ${range.from}-${range.writtenTo} should be written ${range.from}-${abbreviated} — rule 3.2(a) drops repetitious digits but keeps the last two.`,
            {
              context: {
                from: range.from,
                to: range.to,
                written: `${range.from}-${range.writtenTo}`,
                suggestion: `${range.from}-${abbreviated}`,
              },
            },
          ),
        );
      }
    }

    return found;
  },
};

/** A page range that runs backwards — `380-371` cannot be a span of pages. */
export const reversedPageRange: Rule = {
  id: "ST004",
  name: "reversed-page-range",
  summary: "Page range ends before it begins.",
  severity: "warning",

  check(ctx: RuleContext): Diagnostic[] {
    const found: Diagnostic[] = [];

    for (const citation of ctx.extraction.citations) {
      const pin = parsePinCite(citation.pinCite);
      if (!pin) continue;

      for (const range of pin.ranges) {
        if (range.to >= range.from) continue;

        found.push(
          diagnose(
            reversedPageRange,
            citation,
            `Page range ${range.from}-${range.to} ends before it begins. Check for transposed digits.`,
            { context: { from: range.from, to: range.to } },
          ),
        );
      }
    }

    return found;
  },
};

/** Where the opinion starts, following short forms back to their source. */
function startingPage(ctx: RuleContext, citation: ParsedCitation): number | undefined {
  if (citation.kind === "case-reporter") return firstNumber(citation.page);

  // For `516 F.3d at 1254` the parsed page *is* the pin cite, so the real
  // first page has to come from the full citation it resolves to.
  if (!citation.resourceKey) return undefined;
  const members = ctx.extraction.resources.get(citation.resourceKey) ?? [];
  for (const index of members) {
    const candidate = ctx.extraction.citations[index];
    if (candidate?.kind === "case-reporter") return firstNumber(candidate.page);
  }
  return undefined;
}

/** First integer in a pin cite, tolerating `"371-72"` and `"123, 130"`. */
function firstNumber(value: string | undefined): number | undefined {
  return parsePinCite(value)?.first;
}

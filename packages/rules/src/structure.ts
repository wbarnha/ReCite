/** Rules about how citations hang together in a document (the `ST` family). */

import type { Diagnostic, ParsedCitation } from "@recite/core";
import {
  abbreviateRange,
  dropsSectionDigits,
  expandSectionEnd,
  isShortForm,
  parsePinCite,
  parseSections,
} from "@recite/core";

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

/**
 * `Griggs, 181 F.3d at 700-01 (1999)` — a short form carrying a date.
 *
 * Bluebook B10.2: the short form is volume, reporter, `at`, page. The court
 * and the year were given in full the first time and are not repeated. A year
 * here is usually a full citation that has been edited down by hand, and
 * whoever did it stopped halfway.
 */
export const shortFormParenthetical: Rule = {
  id: "ST005",
  name: "short-form-parenthetical",
  summary: "Short-form citation carries a date parenthetical.",
  severity: "warning",

  check(ctx: RuleContext): Diagnostic[] {
    const found: Diagnostic[] = [];

    for (const citation of ctx.extraction.citations) {
      // `Id.` and `supra` never carry a year, so only the reporter short form
      // can reach this. A full citation is supposed to have one.
      if (citation.kind !== "short-form" || citation.year === undefined) continue;

      found.push(
        diagnose(
          shortFormParenthetical,
          citation,
          `Short form ${JSON.stringify(citation.text)} carries the year ${citation.year}. B10.2 gives the date once, in the full citation.`,
          { context: { year: citation.year } },
        ),
      );
    }

    return found;
  },
};

/**
 * `18 U.S.C. § 1544, 1546` — two sections behind one section symbol.
 *
 * Bluebook rule 3.3(b): `§` for one section, `§§` for more than one. The fix
 * rewrites only the symbol, so the authority does not change.
 */
export const sectionSymbolCount: Rule = {
  id: "ST006",
  name: "section-symbol-count",
  summary: "Section symbol does not match the number of sections cited.",
  severity: "warning",

  check(ctx: RuleContext): Diagnostic[] {
    const found: Diagnostic[] = [];

    for (const citation of ctx.extraction.citations) {
      const symbol = citation.sectionSymbol;
      const sections = parseSections(citation.sections);
      if (!symbol || !sections) continue;

      const wanted = sections.join === "single" ? "§" : "§§";
      if (symbol === wanted) continue;

      const at = symbolSpan(ctx, citation, symbol);
      const count = sections.items.length;

      found.push(
        diagnose(
          sectionSymbolCount,
          citation,
          wanted === "§§"
            ? `${JSON.stringify(citation.text)} cites ${count} sections but uses one section symbol. Rule 3.3(b) takes "§§".`
            : `${JSON.stringify(citation.text)} cites one section but uses "§§". Rule 3.3(b) takes "§".`,
          {
            span: at ?? citation.span,
            replacement: at ? wanted : undefined,
            fixSpan: at,
            safety: "safe",
            fixDescription: `Write the section symbol as ${JSON.stringify(wanted)}`,
            context: { written: symbol, expected: wanted, sections: sections.items },
          },
        ),
      );
    }

    return found;
  },
};

/**
 * `17 U.S.C. §§ 103-07` — a span of sections with digits dropped.
 *
 * Rule 3.3(b) runs the opposite way to rule 3.2(a) for pages: pages drop
 * repetitious digits (`371-72`), sections keep all of them (`103-107`).
 * Reversing the two is the mistake this rule exists for, and `ST003` is its
 * counterpart on the page side.
 */
export const sectionRangeDigits: Rule = {
  id: "ST007",
  name: "section-range-digits",
  summary: "Span of sections drops digits the Bluebook keeps.",
  severity: "warning",

  check(ctx: RuleContext): Diagnostic[] {
    const found: Diagnostic[] = [];

    for (const citation of ctx.extraction.citations) {
      const sections = parseSections(citation.sections);
      if (!sections?.span) continue;

      const [from, to] = sections.span;
      if (!dropsSectionDigits(from, to)) continue;

      const expanded = expandSectionEnd(from, to);

      found.push(
        diagnose(
          sectionRangeDigits,
          citation,
          `Sections ${from}-${to} should be written ${from}-${expanded}. Rule 3.3(b) keeps every digit in a span of sections — unlike rule 3.2(a) for pages, which drops them.`,
          {
            context: { from, to, suggestion: `${from}-${expanded}` },
          },
        ),
      );
    }

    return found;
  },
};

/** Where the section symbol sits, so it can be rewritten in place. */
function symbolSpan(
  ctx: RuleContext,
  citation: ParsedCitation,
  symbol: string,
): { start: number; end: number } | undefined {
  const offset = ctx.extraction.text.indexOf(symbol, citation.span.start);
  if (offset < 0 || offset >= citation.span.end) return undefined;
  // `indexOf("§")` finds the first character of `§§` too, so measure the run.
  let end = offset;
  while (end < citation.span.end && ctx.extraction.text[end] === "§") end++;
  return { start: offset, end };
}

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

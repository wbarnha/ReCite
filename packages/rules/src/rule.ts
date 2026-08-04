/** What a rule is, and what it gets to look at. */

import type {
  Correction,
  Diagnostic,
  Extraction,
  FixSafety,
  ParsedCitation,
  Severity,
  Span,
  VerificationResult,
} from "@recite/core";

/** Everything a rule may consult. Rules must not reach outside it. */
export interface RuleContext {
  readonly extraction: Extraction;
  /** Keyed by {@link ParsedCitation.index}. Empty when no verifier ran. */
  readonly verifications: ReadonlyMap<number, VerificationResult>;
  /** Injected so that "is this year in the future?" is testable. */
  readonly currentYear: number;
}

export interface Rule {
  readonly id: string;
  /** Short kebab-case name, e.g. `"reporter-format"`. */
  readonly name: string;
  /** One line, shown by the rule reference. */
  readonly summary: string;
  readonly severity: Severity;
  /** True for rules that are inert without verification results. */
  readonly requiresVerification?: boolean;
  check(ctx: RuleContext): Diagnostic[];
}

export function makeContext(
  extraction: Extraction,
  options: {
    verifications?: ReadonlyMap<number, VerificationResult>;
    currentYear?: number;
  } = {},
): RuleContext {
  return {
    extraction,
    verifications: options.verifications ?? new Map(),
    currentYear: options.currentYear ?? new Date().getFullYear(),
  };
}

export interface DiagnosticOptions {
  readonly severity?: Severity;
  /** Where to point the reader; defaults to the citation itself. */
  readonly span?: Span;
  readonly replacement?: string;
  /** Where to apply the fix; defaults to `span`. */
  readonly fixSpan?: Span;
  readonly safety?: FixSafety;
  readonly fixDescription?: string;
  readonly context?: Record<string, unknown>;
}

/**
 * Build a diagnostic, optionally carrying a correction.
 *
 * A rule attaches a correction only when it can name the right answer. One
 * that cannot say what the text *should* be reports and stops — a wrong fix
 * to a citation is worse than a visible error.
 */
export function diagnose(
  rule: Rule,
  citation: ParsedCitation,
  message: string,
  options: DiagnosticOptions = {},
): Diagnostic {
  const target = options.span ?? citation.span;

  let correction: Correction | undefined;
  if (options.replacement !== undefined) {
    correction = {
      span: options.fixSpan ?? target,
      replacement: options.replacement,
      safety: options.safety ?? "unsafe",
      description: options.fixDescription ?? message,
    };
  }

  return {
    ruleId: rule.id,
    severity: options.severity ?? rule.severity,
    message,
    span: target,
    citationText: citation.text,
    correction,
    context: options.context,
  };
}

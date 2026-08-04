/**
 * The ReCite rule set.
 *
 * Rules are grouped by family so identifiers stay readable in reports:
 *
 * | Prefix | Concern |
 * | ------ | ------- |
 * | `RP`   | the reporter abbreviation itself |
 * | `DT`   | the year, checked against reporter publication ranges |
 * | `CT`   | the court parenthetical |
 * | `ST`   | how citations relate to one another in the document |
 * | `AU`   | whether the authority carries the weight claimed for it |
 * | `VF`   | cross-checks against a corpus of real authorities |
 *
 * Every rule is a plain object with a pure `check`, so the registry can hold
 * one shared instance of each and the whole set runs in a browser.
 */

import type { Diagnostic } from "@recite/core";
import { SEVERITY_RANK } from "@recite/core";

import { databaseOnlyCitation, nonPrecedentialDisposition } from "./authority.js";
import {
  ambiguousCourt,
  courtAbbreviation,
  courtDidNotExist,
  reporterCourtMismatch,
} from "./courts.js";
import { implausibleYear, yearOutsideReporterRange } from "./dates.js";
import {
  inconsistentReporterStyle,
  reporterFormat,
  unknownReporter,
} from "./reporters.js";
import type { Rule, RuleContext } from "./rule.js";
import {
  pageRangeFormat,
  pinCiteOutOfRange,
  reversedPageRange,
  unresolvedShortForm,
} from "./structure.js";
import {
  ambiguousAuthority,
  caseNameMismatch,
  unverifiedAuthority,
  yearMismatch,
} from "./verification.js";

export type { Rule, RuleContext, DiagnosticOptions } from "./rule.js";
export { diagnose, makeContext } from "./rule.js";

export {
  ambiguousAuthority,
  ambiguousCourt,
  caseNameMismatch,
  courtAbbreviation,
  courtDidNotExist,
  databaseOnlyCitation,
  implausibleYear,
  inconsistentReporterStyle,
  nonPrecedentialDisposition,
  pageRangeFormat,
  pinCiteOutOfRange,
  reporterCourtMismatch,
  reversedPageRange,
  reporterFormat,
  unknownReporter,
  unresolvedShortForm,
  unverifiedAuthority,
  yearMismatch,
  yearOutsideReporterRange,
};

const REGISTRY: readonly Rule[] = [
  reporterFormat,
  unknownReporter,
  inconsistentReporterStyle,
  yearOutsideReporterRange,
  implausibleYear,
  courtAbbreviation,
  reporterCourtMismatch,
  courtDidNotExist,
  ambiguousCourt,
  unresolvedShortForm,
  pinCiteOutOfRange,
  pageRangeFormat,
  reversedPageRange,
  nonPrecedentialDisposition,
  databaseOnlyCitation,
  unverifiedAuthority,
  ambiguousAuthority,
  caseNameMismatch,
  yearMismatch,
];

/** Every registered rule, in the order they are reported. */
export function allRules(): readonly Rule[] {
  return REGISTRY;
}

/** Look a rule up by id (`"RP001"`) or name (`"reporter-format"`). */
export function getRule(identifier: string): Rule | undefined {
  const wanted = identifier.trim().toLowerCase();
  return REGISTRY.find((r) => r.id.toLowerCase() === wanted || r.name === wanted);
}

export interface SelectOptions {
  /** Allow-list applied first; when given, only these rules are considered. */
  readonly enable?: readonly string[];
  /** Removed from whatever remains, so the two options compose. */
  readonly disable?: readonly string[];
  /** Drop the `VF` family when no verifier will run. */
  readonly includeVerification?: boolean;
}

export function selectRules(options: SelectOptions = {}): Rule[] {
  const { enable, disable, includeVerification = true } = options;

  let rules = [...REGISTRY];

  if (enable?.length) {
    const wanted = new Set(enable.map((e) => e.trim().toLowerCase()));
    rules = rules.filter((r) => wanted.has(r.id.toLowerCase()) || wanted.has(r.name));
  }
  if (disable?.length) {
    const unwanted = new Set(disable.map((d) => d.trim().toLowerCase()));
    rules = rules.filter(
      (r) => !unwanted.has(r.id.toLowerCase()) && !unwanted.has(r.name),
    );
  }
  if (!includeVerification) {
    rules = rules.filter((r) => !r.requiresVerification);
  }

  return rules;
}

/**
 * Run rules over one document and return the findings in text order.
 *
 * A rule that throws is not allowed to take the run down with it: one broken
 * check should cost you that check, not the whole report.
 */
export function runRules(
  ctx: RuleContext,
  rules: readonly Rule[] = REGISTRY,
): Diagnostic[] {
  const findings: Diagnostic[] = [];

  for (const rule of rules) {
    try {
      findings.push(...rule.check(ctx));
    } catch (error) {
      console.warn(`ReCite: rule ${rule.id} failed and was skipped:`, error);
    }
  }

  return findings.sort(
    (a, b) =>
      a.span.start - b.span.start ||
      SEVERITY_RANK[b.severity] - SEVERITY_RANK[a.severity] ||
      a.ruleId.localeCompare(b.ruleId),
  );
}

export const RULES_VERSION = "1.0.0.0";

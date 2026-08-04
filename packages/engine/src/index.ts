/**
 * The pipeline that ties everything together.
 *
 * ```
 * document -> parse -> [verify] -> rules -> diagnostics -> [apply fixes]
 *            (core)    (provider) (rules)                    (core/text)
 * ```
 *
 * {@link Engine.check} stops at diagnostics; {@link Engine.fix} continues and
 * returns the rewritten document. Everything above this layer — the web app,
 * the Word add-in, a future CLI — should only need these two calls.
 */

import type {
  Correction,
  Diagnostic,
  Extraction,
  ParseOptions,
  Severity,
  VerificationProvider,
  VerificationResult,
} from "@recite/core";
import { applyCorrections, lineDiff, parse } from "@recite/core";
import type { Rule } from "@recite/rules";
import { makeContext, runRules, selectRules } from "@recite/rules";

export interface CheckResult {
  readonly text: string;
  readonly extraction: Extraction;
  readonly diagnostics: readonly Diagnostic[];
  readonly verifications: ReadonlyMap<number, VerificationResult>;
}

export interface FixResult {
  readonly check: CheckResult;
  readonly fixedText: string;
  readonly applied: readonly Correction[];
  readonly skipped: ReadonlyArray<readonly [Correction, string]>;
  readonly changed: boolean;
}

export interface EngineOptions {
  /** Defaults to the whole registry, minus `VF` when no provider is given. */
  readonly rules?: readonly Rule[];
  readonly provider?: VerificationProvider;
  readonly parseOptions?: ParseOptions;
  /** Injected for deterministic tests. */
  readonly currentYear?: number;
}

export interface FixOptions {
  /**
   * Also apply corrections that change which authority is cited. Off by
   * default: a confidently wrong citation is worse than a visibly broken one.
   */
  readonly unsafe?: boolean;
}

export class Engine {
  private readonly rules: readonly Rule[];
  private readonly provider?: VerificationProvider;
  private readonly parseOptions: ParseOptions;
  private readonly currentYear: number;

  constructor(options: EngineOptions = {}) {
    this.provider = options.provider;
    this.parseOptions = options.parseOptions ?? {};
    this.currentYear = options.currentYear ?? new Date().getFullYear();
    this.rules =
      options.rules ?? selectRules({ includeVerification: Boolean(options.provider) });
  }

  get activeRules(): readonly Rule[] {
    return this.rules;
  }

  async check(text: string): Promise<CheckResult> {
    const extraction = parse(text, this.parseOptions);

    let verifications: ReadonlyMap<number, VerificationResult> = new Map();
    if (this.provider) {
      try {
        verifications = await this.provider.verify(extraction.citations);
      } catch (error) {
        // A verifier that is down must not take the offline rules with it.
        console.warn("ReCite: verification failed; continuing offline.", error);
      }
    }

    const ctx = makeContext(extraction, {
      verifications,
      currentYear: this.currentYear,
    });

    return {
      text,
      extraction,
      diagnostics: runRules(ctx, this.rules),
      verifications,
    };
  }

  async fix(text: string, options: FixOptions = {}): Promise<FixResult> {
    const check = await this.check(text);
    const corrections = fixableCorrections(check.diagnostics, options.unsafe ?? false);
    const patch = applyCorrections(check.text, corrections);

    return {
      check,
      fixedText: patch.text,
      applied: patch.applied,
      skipped: patch.skipped,
      changed: patch.changed,
    };
  }
}

/** Corrections we are allowed to apply, given the safety setting. */
export function fixableCorrections(
  diagnostics: readonly Diagnostic[],
  unsafe: boolean,
): Correction[] {
  return diagnostics
    .map((d) => d.correction)
    .filter((c): c is Correction => Boolean(c) && (unsafe || c!.safety === "safe"));
}

export function countBySeverity(
  diagnostics: readonly Diagnostic[],
): Record<Severity, number> {
  const counts: Record<Severity, number> = { error: 0, warning: 0, info: 0 };
  for (const d of diagnostics) counts[d.severity]++;
  return counts;
}

export function diff(result: FixResult): string {
  return lineDiff(result.check.text, result.fixedText);
}

export const ENGINE_VERSION = "1.0.0.0";

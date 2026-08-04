/**
 * Checking a citation against a record of authorities that actually exist.
 *
 * ReCite ships no authority database of its own and calls no service by
 * default. This module defines the *shape* of a verifier so that the rule set
 * can consume results without knowing where they came from, plus one
 * implementation — {@link CorpusProvider} — that answers from a corpus the
 * caller supplies.
 *
 * That distinction matters for how findings should be read. A corpus can only
 * tell you a citation is *absent from that corpus*. It is evidence to check
 * something by hand, never proof that a case does not exist.
 */

import type { ParsedCitation } from "./model.js";
import { lookupKey } from "./model.js";

export interface AuthorityRecord {
  /** Canonical citation, e.g. `"410 U.S. 113"`. */
  readonly key: string;
  readonly caseName: string;
  readonly year?: number;
  readonly courtId?: string;
  readonly url?: string;
}

export type VerificationStatus =
  /** Exactly one authority matched. */
  | "found"
  /** The citation is well-formed but absent from the corpus. */
  | "not-found"
  /** Several authorities matched; the citation does not pick one out. */
  | "ambiguous"
  /** Nothing was looked up — no verifier configured, or it failed. */
  | "unchecked";

export interface VerificationResult {
  readonly citationIndex: number;
  readonly status: VerificationStatus;
  readonly records: readonly AuthorityRecord[];
  /** Which verifier answered, for display and for reproducing a report. */
  readonly source: string;
}

export interface VerificationProvider {
  readonly name: string;
  /**
   * Look up citations, returning results keyed by {@link ParsedCitation.index}.
   * A provider may omit any citation it did not check.
   */
  verify(
    citations: readonly ParsedCitation[],
  ): Promise<Map<number, VerificationResult>>;
}

/**
 * Answers from an in-memory list of authorities.
 *
 * This is what makes verification usable in a static web page and in Word,
 * where there is no server to call: a firm points ReCite at its own list of
 * authorities and gets the hallucination check without any network access.
 */
export class CorpusProvider implements VerificationProvider {
  readonly name: string;
  private readonly byKey: Map<string, AuthorityRecord[]>;

  constructor(records: readonly AuthorityRecord[], name = "corpus") {
    this.name = name;
    this.byKey = new Map();
    for (const record of records) {
      const key = normalizeKey(record.key);
      const bucket = this.byKey.get(key);
      if (bucket) bucket.push(record);
      else this.byKey.set(key, [record]);
    }
  }

  get size(): number {
    return this.byKey.size;
  }

  verify(
    citations: readonly ParsedCitation[],
  ): Promise<Map<number, VerificationResult>> {
    const results = new Map<number, VerificationResult>();

    for (const citation of citations) {
      const key = lookupKey(citation);
      // Short forms and statutes have nothing of their own to look up.
      if (!key) continue;

      const matches = this.byKey.get(normalizeKey(key)) ?? [];
      results.set(citation.index, {
        citationIndex: citation.index,
        status:
          matches.length === 0
            ? "not-found"
            : matches.length === 1
              ? "found"
              : "ambiguous",
        records: matches,
        source: this.name,
      });
    }

    return Promise.resolve(results);
  }
}

/** Compare citations without letting spacing decide the answer. */
function normalizeKey(key: string): string {
  return key.toLowerCase().replace(/\s+/g, " ").trim();
}

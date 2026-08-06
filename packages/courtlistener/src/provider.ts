/**
 * CourtListener as a {@link @recite/core!VerificationProvider}.
 *
 * The engine already knows how to consume verification results — that is what
 * `CorpusProvider` and the `VF` rules were built around — so plugging a real
 * database in needs no change to the rule set at all. `VF001` goes from
 * "absent from the list you pasted" to "absent from a collection of some ten
 * million American decisions", and the wording holds either way, which is the
 * point of having phrased it as absence rather than as fabrication.
 *
 * Two behaviours are deliberate and worth stating:
 *
 * - **A lookup that fails is `unchecked`, never `not-found`.** A timeout, a
 *   throttle or a rejected token must not read as evidence that a case does
 *   not exist. That failure mode would be worse than not checking at all.
 * - **Duplicates cost one request.** A brief cites the same case eight times;
 *   the rate limit should not.
 */

import type {
  AuthorityRecord,
  ParsedCitation,
  VerificationProvider,
  VerificationResult,
  VerificationStatus,
} from "@recite/core";

import type { CourtListenerClient } from "./http.js";
import { citationComponents, keyFor, lookupOne } from "./lookup.js";
import type { CourtListenerCluster, CourtListenerMatch } from "./model.js";
import { RateLimiter } from "./throttle.js";

/**
 * CourtListener's published ceiling for the citation-lookup endpoint: sixty
 * citations a minute per token.
 */
export const LOOKUPS_PER_MINUTE = 60;

/**
 * How many citations one check will look up before it stops.
 *
 * A ceiling rather than an unbounded queue, because at sixty a minute an
 * eight-hundred-citation appendix would keep the pane busy for a quarter of an
 * hour. Whatever is dropped is *reported* — see {@link CourtListenerProvider.notices} —
 * since a silent cap reads exactly like a document that checked out clean.
 */
export const DEFAULT_MAX_LOOKUPS = 120;

export interface CourtListenerProviderOptions {
  readonly client: CourtListenerClient;
  readonly limiter?: RateLimiter;
  readonly maxLookups?: number;
  readonly onProgress?: (done: number, total: number) => void;
}

export class CourtListenerProvider implements VerificationProvider {
  readonly name = "CourtListener";

  private readonly client: CourtListenerClient;
  private readonly limiter: RateLimiter;
  private readonly maxLookups: number;
  private readonly onProgress?: (done: number, total: number) => void;

  /** Keyed by citation index; what {@link verify} learned, kept for annotation. */
  private readonly matches = new Map<number, CourtListenerMatch>();
  /**
   * Keyed by citation, and kept for the life of the provider.
   *
   * Applying a fix re-checks the document, because offsets from before an edit
   * no longer describe it. Without this, correcting one comma would spend a
   * second round of rate limit re-asking about every citation in the brief —
   * and the answers cannot have changed in the intervening second.
   */
  private readonly cache = new Map<string, CourtListenerMatch>();
  /** Anything the user should be told about the run, in plain words. */
  private readonly log: string[] = [];

  constructor(options: CourtListenerProviderOptions) {
    this.client = options.client;
    this.limiter =
      options.limiter ?? new RateLimiter({ perWindow: LOOKUPS_PER_MINUTE });
    this.maxLookups = options.maxLookups ?? DEFAULT_MAX_LOOKUPS;
    if (options.onProgress) this.onProgress = options.onProgress;
  }

  get notices(): readonly string[] {
    return this.log;
  }

  /** What CourtListener said about one citation, if it was looked up. */
  matchFor(citationIndex: number): CourtListenerMatch | undefined {
    return this.matches.get(citationIndex);
  }

  get lookups(): ReadonlyMap<number, CourtListenerMatch> {
    return this.matches;
  }

  async verify(
    citations: readonly ParsedCitation[],
  ): Promise<Map<number, VerificationResult>> {
    this.matches.clear();
    this.log.length = 0;

    /** One entry per distinct citation, in document order. */
    const wanted: Array<{
      readonly key: string;
      readonly indexes: number[];
      readonly components: NonNullable<ReturnType<typeof citationComponents>>;
    }> = [];
    const byKey = new Map<string, (typeof wanted)[number]>();

    for (const citation of citations) {
      const components = citationComponents(citation);
      const key = keyFor(citation);
      if (!components || !key) continue;

      const existing = byKey.get(key);
      if (existing) {
        existing.indexes.push(citation.index);
        continue;
      }
      const entry = { key, indexes: [citation.index], components };
      byKey.set(key, entry);
      wanted.push(entry);
    }

    // A citation already answered for costs nothing and does not count
    // against the ceiling, so a re-check after a fix is free.
    const fresh = wanted.filter((entry) => !this.cache.has(entry.key));
    const budget = new Set(fresh.slice(0, this.maxLookups));
    if (fresh.length > budget.size) {
      this.log.push(
        `Looked up the first ${budget.size} of ${fresh.length} distinct citations. ` +
          `The remaining ${fresh.length - budget.size} were not checked — they are ` +
          "not verified, and not absent either.",
      );
    }

    const results = new Map<number, VerificationResult>();
    let done = 0;

    for (const entry of wanted) {
      const cached = this.cache.get(entry.key);
      if (!cached && !budget.has(entry)) continue;

      let match = cached;
      if (!match) {
        await this.limiter.take();
        match = await lookupOne(
          this.client,
          entry.indexes[0]!,
          entry.key,
          entry.components,
        );
        // A transport failure is not an answer, so it is not remembered:
        // asking again after the network comes back is the right behaviour.
        if (match.status !== "unchecked") this.cache.set(entry.key, match);
        done++;
        this.onProgress?.(done, budget.size);
      }

      for (const index of entry.indexes) {
        const forIndex: CourtListenerMatch = { ...match, citationIndex: index };
        this.matches.set(index, forIndex);
        results.set(index, this.toResult(forIndex));
      }
    }

    const failed = [...this.matches.values()].filter((m) => m.status === "unchecked");
    if (failed.length > 0) {
      this.log.push(
        `${failed.length} citation${failed.length === 1 ? "" : "s"} could not be ` +
          `checked: ${failed[0]!.note ?? "CourtListener did not answer."}`,
      );
    }

    return results;
  }

  private toResult(match: CourtListenerMatch): VerificationResult {
    return {
      citationIndex: match.citationIndex,
      status: toStatus(match.status),
      records: match.clusters.map(toRecord(match.key)),
      source: this.name,
    };
  }
}

/**
 * `invalid` becomes `unchecked`, not `not-found`.
 *
 * "CourtListener could not parse this citation" is a statement about the
 * lookup, not about the world. Reporting it as absence would have `VF001`
 * accuse a real decision of not existing because its reporter abbreviation is
 * unusual.
 */
function toStatus(status: CourtListenerMatch["status"]): VerificationStatus {
  switch (status) {
    case "found":
      return "found";
    case "not-found":
      return "not-found";
    case "ambiguous":
      return "ambiguous";
    default:
      return "unchecked";
  }
}

const toRecord =
  (key: string) =>
  (cluster: CourtListenerCluster): AuthorityRecord => ({
    key,
    caseName: cluster.caseName,
    ...(cluster.year !== undefined ? { year: cluster.year } : {}),
    ...(cluster.courtId ? { courtId: cluster.courtId } : {}),
    ...(cluster.url ? { url: cluster.url } : {}),
  });

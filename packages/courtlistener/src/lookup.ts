/**
 * Looking a citation up, and the one rule that governs how.
 *
 * CourtListener's citation-lookup endpoint takes either a block of `text`,
 * which it scans for citations, or a `volume`, a `reporter` and a `page`.
 * **ReCite only ever sends the three components.** The `text` form would be
 * fewer requests and is the obvious optimisation, and taking it would mean
 * posting a client's brief to a third party — which is the one thing this
 * project exists to not do. {@link buildLookupForm} is the whole of what
 * leaves the machine, and a test asserts it can produce nothing else.
 *
 * The response is documented as a per-citation `status` that mirrors HTTP:
 *
 * | `status` | Meaning                                    |
 * | -------- | ------------------------------------------ |
 * | 200      | matched                                    |
 * | 300      | several decisions carry that citation      |
 * | 404      | no decision in the collection carries it   |
 * | 400      | the citation could not be parsed at all    |
 * | 429      | this token has been throttled              |
 */

import type { ParsedCitation } from "@recite/core";
import { lookupKey } from "@recite/core";

import type { CourtListenerClient } from "./http.js";
import { COURTLISTENER_ORIGIN } from "./http.js";
import type { CourtListenerCluster, CourtListenerMatch } from "./model.js";

export const CITATION_LOOKUP_PATH = "/api/rest/v4/citation-lookup/";

/** A citation split into the three things CourtListener is given. */
export interface CitationComponents {
  readonly volume: string;
  readonly reporter: string;
  readonly page: string;
}

/**
 * Split a parsed citation into exactly the fields that may be transmitted.
 *
 * Returns `undefined` for anything that is not a full case-reporter citation:
 * short forms have nothing of their own to look up, and statutes are not case
 * law. Neither is sent, which also means neither consumes a rate-limit slot.
 */
export function citationComponents(
  citation: ParsedCitation,
): CitationComponents | undefined {
  if (citation.kind !== "case-reporter") return undefined;
  const reporter = citation.reporterCanonical ?? citation.reporter;
  if (!citation.volume || !reporter || !citation.page) return undefined;
  return { volume: citation.volume, reporter, page: citation.page };
}

/**
 * The request body, in full.
 *
 * Three keys, all of them numbers or a reporter abbreviation. There is no
 * branch that adds a fourth, and no path by which document text reaches this
 * function — it takes components, not a citation and not a document.
 */
export function buildLookupForm(
  components: CitationComponents,
): Record<string, string> {
  return {
    volume: components.volume,
    reporter: components.reporter,
    page: components.page,
  };
}

// ------------------------------------------------------------- responses ---

/** The subset of CourtListener's cluster object ReCite reads. */
interface RawCluster {
  readonly id?: number;
  readonly absolute_url?: string;
  readonly case_name?: string;
  readonly date_filed?: string;
  readonly citation_count?: number;
  readonly court_id?: string;
  readonly sub_opinions?: readonly string[];
}

interface RawLookup {
  readonly citation?: string;
  readonly status?: number;
  readonly error_message?: string;
  readonly clusters?: readonly RawCluster[];
}

function toCluster(raw: RawCluster, origin: string): CourtListenerCluster | undefined {
  if (typeof raw.id !== "number") return undefined;
  const year = Number(raw.date_filed?.slice(0, 4));

  return {
    id: raw.id,
    caseName: raw.case_name ?? "(unnamed decision)",
    ...(raw.date_filed ? { dateFiled: raw.date_filed } : {}),
    ...(Number.isInteger(year) ? { year } : {}),
    ...(raw.absolute_url ? { url: `${origin}${raw.absolute_url}` } : {}),
    ...(raw.court_id ? { courtId: raw.court_id } : {}),
    ...(typeof raw.citation_count === "number"
      ? { citationCount: raw.citation_count }
      : {}),
    opinionUrls: (raw.sub_opinions ?? []).filter(
      (url): url is string => typeof url === "string",
    ),
  };
}

/** Map one entry of the response onto a {@link CourtListenerMatch}. */
export function interpret(
  citationIndex: number,
  key: string,
  raw: RawLookup | undefined,
  origin: string = COURTLISTENER_ORIGIN,
): CourtListenerMatch {
  const clusters = (raw?.clusters ?? [])
    .map((cluster) => toCluster(cluster, origin))
    .filter((cluster): cluster is CourtListenerCluster => cluster !== undefined);

  const base = { citationIndex, key, clusters };
  switch (raw?.status) {
    case 200:
      // A 200 with several clusters is the ambiguous case in disguise: the
      // citation is real but does not pick out one decision.
      return { ...base, status: clusters.length > 1 ? "ambiguous" : "found" };
    case 300:
      return { ...base, status: "ambiguous" };
    case 404:
      return { ...base, status: "not-found" };
    case 400:
      return {
        ...base,
        status: "invalid",
        note: raw.error_message || "CourtListener could not parse this citation.",
      };
    default:
      return {
        ...base,
        status: "unchecked",
        note:
          raw?.error_message ||
          `CourtListener answered with an unexpected status (${String(raw?.status)}).`,
      };
  }
}

/**
 * Look one citation up.
 *
 * A lookup that fails at the transport level comes back as `unchecked` rather
 * than throwing: one citation CourtListener could not answer for must not
 * cost the reader the other ninety-nine, and — more importantly — must never
 * be shown as though the case did not exist.
 */
export async function lookupOne(
  client: CourtListenerClient,
  citationIndex: number,
  key: string,
  components: CitationComponents,
): Promise<CourtListenerMatch> {
  try {
    const body = await client.json<unknown>(CITATION_LOOKUP_PATH, {
      method: "POST",
      form: buildLookupForm(components),
    });
    // The endpoint answers with one entry per citation it was given, and it
    // was given one. Read defensively anyway: this is a shape from the
    // network, and a proxy that returns an object rather than an array should
    // produce "unchecked", not a crash halfway through a document.
    const first = Array.isArray(body) ? (body[0] as RawLookup | undefined) : undefined;
    return interpret(citationIndex, key, first, client.origin);
  } catch (error) {
    return {
      citationIndex,
      key,
      status: "unchecked",
      clusters: [],
      note: error instanceof Error ? error.message : String(error),
    };
  }
}

/** The `"410 U.S. 113"` form, so a match can be shared between duplicates. */
export function keyFor(citation: ParsedCitation): string | undefined {
  return lookupKey(citation);
}

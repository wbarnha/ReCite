/**
 * CourtListener, kept at arm's length.
 *
 * This package is the only part of ReCite that can open a connection to
 * another origin, and it is a separate package precisely so that sentence
 * stays checkable. `@recite/rules` depends on `@recite/core`; it does not
 * depend on this, so a rule cannot reach the network even by accident —
 * nothing in its scope can.
 *
 * What it offers:
 *
 * - {@link CourtListenerProvider} — a `VerificationProvider` backed by the
 *   Free Law Project's collection, so `VF001` stops meaning "absent from the
 *   five cases you pasted" and starts meaning "absent from the case law".
 * - {@link annotateCitations} — the passage a pin cite points at, pulled from
 *   the opinion's star pagination, ready to become a comment in a document.
 *
 * What leaves the machine is a volume, a reporter abbreviation and a page —
 * never document text. See `lookup.ts`, which is short on purpose.
 */

export {
  annotateCitations,
  annotationComment,
  DEFAULT_MAX_ANNOTATIONS,
  matchForCitation,
  pinPage,
  type AnnotateOptions,
  type AnnotateResult,
} from "./annotate.js";

export {
  CourtListenerClient,
  CourtListenerError,
  COURTLISTENER_HELP_URL,
  COURTLISTENER_ORIGIN,
  looksLikeToken,
  redact,
  type ClientOptions,
  type FetchLike,
  type HttpRequestInit,
  type HttpResponse,
} from "./http.js";

export {
  buildLookupForm,
  citationComponents,
  CITATION_LOOKUP_PATH,
  interpret,
  keyFor,
  lookupOne,
  type CitationComponents,
} from "./lookup.js";

export {
  clusterYear,
  type Annotation,
  type CourtListenerCluster,
  type CourtListenerMatch,
  type PinciteQuotation,
} from "./model.js";

export {
  bestBody,
  DEFAULT_QUOTE_CHARS,
  markupToText,
  opinionPath,
  quoteAtPage,
  quoteFromStart,
  quotePincite,
  tidyQuotation,
  type PinciteOptions,
} from "./pincite.js";

export {
  CourtListenerProvider,
  DEFAULT_MAX_LOOKUPS,
  LOOKUPS_PER_MINUTE,
  type CourtListenerProviderOptions,
} from "./provider.js";

export { RateLimiter, type ThrottleOptions } from "./throttle.js";

export const COURTLISTENER_VERSION = "1.0.0.0";

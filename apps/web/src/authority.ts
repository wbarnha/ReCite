/**
 * Where "does this case exist?" gets its answer.
 *
 * ReCite has always been able to check a citation against a list of
 * authorities, and has always been careful about what absence from that list
 * means. There are now three answers to choose between, and the difference
 * between them is the difference between a prompt and a finding:
 *
 * | Source          | What "absent" means                                  |
 * | --------------- | ---------------------------------------------------- |
 * | `none`          | nothing is checked; every offline rule still runs     |
 * | `sample`        | absent from five demonstration cases — almost nothing |
 * | `courtlistener` | absent from a collection of American case law         |
 *
 * Only the third is worth acting on, and it is the only one that opens a
 * connection. That is why it needs a token: turning it on is a deliberate act
 * with a stated consequence, not a default someone drifts into.
 */

import type { FetchLike } from "@recite/courtlistener";
import { CourtListenerClient, CourtListenerProvider } from "@recite/courtlistener";

export type AuthoritySource = "none" | "sample" | "courtlistener";

export const AUTHORITY_LABEL: Record<AuthoritySource, string> = {
  none: "Do not check whether cases exist",
  sample: "The five-case sample list",
  courtlistener: "CourtListener (needs an API token)",
};

/** What a saved report should record about how it was checked. */
export const AUTHORITY_PROVENANCE: Record<AuthoritySource, string> = {
  none: "no authority check was run",
  sample: "ReCite's five-case demonstration list",
  courtlistener: "CourtListener, the Free Law Project's collection",
};

/**
 * `fetch`, narrowed to what the client uses.
 *
 * Written as a wrapper rather than passed by reference so the call site is a
 * literal one line of this file. `tools/test/privacy-claims.test.ts` pins
 * every place in the shipped source that can open a request, and a wrapper
 * that is obviously a wrapper is easier to argue about than an alias.
 */
const browserFetch: FetchLike = (url, init) => fetch(url, init);

export interface CourtListenerSetup {
  readonly token: string;
  readonly onProgress?: (done: number, total: number) => void;
}

export function makeCourtListenerProvider({
  token,
  onProgress,
}: CourtListenerSetup): CourtListenerProvider {
  return new CourtListenerProvider({
    client: new CourtListenerClient({ token, fetch: browserFetch }),
    ...(onProgress ? { onProgress } : {}),
  });
}

export function makeCourtListenerClient(token: string): CourtListenerClient {
  return new CourtListenerClient({ token, fetch: browserFetch });
}

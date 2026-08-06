import { COURTLISTENER_HELP_URL } from "@recite/courtlistener";
import { useId } from "react";

import type { AuthoritySource } from "../authority.js";
import { AUTHORITY_LABEL } from "../authority.js";

const SOURCES: readonly AuthoritySource[] = ["none", "sample", "courtlistener"];

export interface AuthorityPickerProps {
  readonly source: AuthoritySource;
  readonly onSource: (source: AuthoritySource) => void;
  readonly token: string;
  readonly onToken: (token: string) => void;
  readonly tokenUsable: boolean;
  readonly hasCorpus: boolean;
  readonly disabled?: boolean;
}

/**
 * Whether to check that the cited cases exist, and against what.
 *
 * This is the control that decides whether ReCite can catch a fabrication at
 * all. Every other rule is about form, and a citation invented with a
 * plausible reporter, court and year passes all of them — which is the whole
 * lesson of _Mata v. Avianca_ and the reason this dropdown is not buried.
 *
 * The CourtListener option is the only thing in ReCite that opens a connection
 * to another origin, so it says so, in the place where it is switched on,
 * rather than only in a policy nobody reads. The token is held in memory for
 * the tab and written nowhere: no `localStorage`, no cookie, no IndexedDB —
 * the same rule the document itself is handled under.
 */
export function AuthorityPicker({
  source,
  onSource,
  token,
  onToken,
  tokenUsable,
  hasCorpus,
  disabled,
}: AuthorityPickerProps) {
  const selectId = useId();
  const tokenId = useId();

  return (
    <div className="authority">
      <div className="toolbar">
        <label className="checkbox" htmlFor={selectId}>
          Verify cases against
        </label>
        <select
          id={selectId}
          value={source}
          disabled={disabled}
          aria-label="Where to check that a cited case exists"
          onChange={(event) => onSource(event.target.value as AuthoritySource)}
        >
          {SOURCES.filter((candidate) => candidate !== "sample" || hasCorpus).map(
            (candidate) => (
              <option key={candidate} value={candidate}>
                {AUTHORITY_LABEL[candidate]}
              </option>
            ),
          )}
        </select>
      </div>

      {source === "sample" && (
        <div className="notice">
          The sample list holds five cases, so most citations in any real document will
          be missing from it. That is a prompt to check one by hand — not evidence a
          case does not exist.
        </div>
      )}

      {source === "courtlistener" && (
        <div className="notice authority-online">
          <p>
            <strong>This is the one thing ReCite sends anywhere.</strong> With a token
            in the box below, each citation is looked up as a{" "}
            <strong>volume, a reporter and a page</strong> — <code>410</code>,{" "}
            <code>U.S.</code>, <code>113</code>. Your document is not sent, and there is
            no code path that could send it. Everything else still runs in this page.
          </p>
          <p>
            <a href={COURTLISTENER_HELP_URL} target="_blank" rel="noreferrer noopener">
              Get a free API token
            </a>{" "}
            from the Free Law Project. It is kept in this tab&rsquo;s memory and written
            nowhere; closing the tab forgets it.
          </p>
          <label className="authority-token" htmlFor={tokenId}>
            CourtListener API token
            <input
              id={tokenId}
              type="password"
              value={token}
              disabled={disabled}
              spellCheck={false}
              autoComplete="off"
              placeholder="40 characters, from your CourtListener profile"
              onChange={(event) => onToken(event.target.value)}
            />
          </label>
          {token.length > 0 && !tokenUsable && (
            <p className="import-warning">
              That does not look like a CourtListener token. They are a single run of
              about forty letters and digits.
            </p>
          )}
        </div>
      )}
    </div>
  );
}

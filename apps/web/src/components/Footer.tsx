import { BUILD_INFO, REPO_URL, SHORT_COMMIT } from "../build-info.js";

/**
 * Which build you are looking at.
 *
 * The commit is a link to the source it was built from, because that is what
 * makes it useful rather than decorative: a reader can go from the page in
 * front of them to the exact diff, and compare either against the published
 * checksums. On a site that deploys on every push to the default branch, the
 * version number alone does not identify a build — the commit does.
 */
export function Footer({ compact = false }: { compact?: boolean }) {
  return (
    <footer className="footer">
      <p className="build-line">
        ReCite <code>{BUILD_INFO.version}</code> · commit{" "}
        <a
          className="commit"
          href={`${REPO_URL}/commit/${BUILD_INFO.commit}`}
          rel="noreferrer"
          title={BUILD_INFO.commit}
        >
          <code>{SHORT_COMMIT}</code>
        </a>{" "}
        · built <code>{BUILD_INFO.builtAt}</code>
      </p>
      {!compact && (
        <>
          <p>
            Verify this build against <a href="./integrity.json">integrity.json</a> and{" "}
            <a href="./checksums.sha256">checksums.sha256</a>.
          </p>
          <p>
            <a href="./tutorial.html">Walkthrough</a> ·{" "}
            <a href="./privacy.html">Privacy</a> · <a href="./terms.html">Terms</a> ·{" "}
            <a href="./support.html">Support</a> ·{" "}
            <a href={REPO_URL} rel="noreferrer">
              Source
            </a>
          </p>
        </>
      )}
      <p>
        ReCite reports problems it can demonstrate. It is not legal advice, and a clean
        result is not a guarantee that a citation is correct.
      </p>
    </footer>
  );
}

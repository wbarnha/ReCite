import { BUILD_INFO, SHORT_COMMIT } from "../build-info.js";

/**
 * Build identity, shown so a reader can check the page against the published
 * checksums rather than take it on trust.
 */
export function Footer({ compact = false }: { compact?: boolean }) {
  return (
    <footer className="footer">
      <p>
        ReCite <code>{BUILD_INFO.version}</code> · commit <code>{SHORT_COMMIT}</code> ·
        built <code>{BUILD_INFO.builtAt}</code>
      </p>
      {!compact && (
        <p>
          Verify this build against <a href="./integrity.json">integrity.json</a> and{" "}
          <a href="./checksums.sha256">checksums.sha256</a>. Everything runs in your
          browser; no document text is uploaded.
        </p>
      )}
      <p>
        ReCite reports problems it can demonstrate. It is not legal advice, and a clean
        result is not a guarantee that a citation is correct.
      </p>
    </footer>
  );
}

/**
 * Build identity, baked in by Vite at compile time.
 *
 * Displayed in the UI so a reader can match the page they are looking at
 * against the checksums published alongside the release. See
 * `tools/integrity/` and `docs/security.md`.
 */

declare const __RECITE_VERSION__: string;
declare const __RECITE_COMMIT__: string;
declare const __RECITE_BUILT_AT__: string;
declare const __RECITE_REPO_URL__: string;
declare const __RECITE_TESSDATA_DIR__: string;

/**
 * The directory the OCR language models are served from, content-addressed.
 *
 * Baked in from `tools/tessdata`, which is also what writes the directory, so
 * the name in the bundle and the name on disk come from one computation. See
 * that file for why the hash is on the directory rather than the filename.
 */
export const TESSDATA_DIR = __RECITE_TESSDATA_DIR__;

export const BUILD_INFO = {
  version: __RECITE_VERSION__,
  commit: __RECITE_COMMIT__,
  builtAt: __RECITE_BUILT_AT__,
} as const;

export const SHORT_COMMIT = BUILD_INFO.commit.slice(0, 12);

/**
 * Where the source lives, so the commit shown in the footer can be a link.
 *
 * Baked in at build time from `GITHUB_REPOSITORY` rather than hardcoded, so a
 * fork's page points at the fork's commits.
 */
export const REPO_URL = __RECITE_REPO_URL__;

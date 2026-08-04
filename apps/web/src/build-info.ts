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

export const BUILD_INFO = {
  version: __RECITE_VERSION__,
  commit: __RECITE_COMMIT__,
  builtAt: __RECITE_BUILT_AT__,
} as const;

export const SHORT_COMMIT = BUILD_INFO.commit.slice(0, 12);

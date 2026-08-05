/**
 * Where the release version comes from.
 *
 * A tagged GitHub release is the source of truth. Everything that carries a
 * version — the Office manifest, the npm packages, the string the UI shows —
 * is derived from the tag by this module, so a release cannot ship with two
 * different numbers on it.
 *
 * Two spellings are needed and they are not interchangeable:
 *
 * - **npm** takes semver: `1.2.3`, optionally with a prerelease suffix.
 * - **Office** takes exactly four numeric components: `1.2.3.0`. It is not
 *   semver, it does not accept a suffix, and Word keys upgrades on it.
 *
 * The fourth component is always zero. Office would let us use it as a build
 * counter, but nothing else in the project has a number to put there, and a
 * value that moved independently of the tag would be one more thing that could
 * disagree with the release it came from.
 *
 * Outside a tagged build — local development, a branch, a pull request —
 * there is no tag to read, so the baseline in `version.json` is used and
 * labelled as such in the build log.
 */

import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, "..", "..");

/**
 * The fourth component of the Office version, always zero.
 *
 * See the module comment: this is deliberate, not a placeholder.
 */
export const PRODUCT_REVISION = 0;

/**
 * Office rejects a manifest whose `<Version>` has a component above this.
 * Worth checking here rather than discovering it at the point where a store
 * submission is rejected.
 */
const MAX_COMPONENT = 65535;

/**
 * `v1.2.3`, `1.2.3`, `v1.2.3-rc.1`, `v1.2.3+build.5`.
 *
 * The leading `v` is optional because both conventions are common in GitHub
 * tags and neither is wrong.
 */
const TAG_PATTERN =
  /^v?(\d{1,5})\.(\d{1,5})\.(\d{1,5})(?:-([0-9A-Za-z][0-9A-Za-z.-]*))?(?:\+[0-9A-Za-z][0-9A-Za-z.-]*)?$/;

export interface ReleaseVersion {
  /** What npm accepts, including any prerelease suffix: `1.2.3-rc.1`. */
  readonly semver: string;
  /** What Office requires. Four components, the last always zero. */
  readonly product: string;
  readonly major: number;
  readonly minor: number;
  readonly patch: number;
  /** The prerelease suffix, if the tag carried one. */
  readonly prerelease?: string;
  /** Human-readable provenance, for the build log. */
  readonly source: string;
  /** Whether this came from a release tag rather than the baseline file. */
  readonly tagged: boolean;
}

export class VersionError extends Error {
  override readonly name = "VersionError";
}

interface Parsed {
  major: number;
  minor: number;
  patch: number;
  prerelease?: string;
}

/**
 * Read a release tag. Returns `undefined` rather than throwing so callers can
 * decide whether an unparseable tag is fatal — during a release it is.
 */
export function parseVersionTag(tag: string): Parsed | undefined {
  const match = TAG_PATTERN.exec(tag.trim());
  if (!match) return undefined;

  const [, major, minor, patch, prerelease] = match;
  const parsed: Parsed = {
    major: Number(major),
    minor: Number(minor),
    patch: Number(patch),
  };
  if (prerelease !== undefined) parsed.prerelease = prerelease;

  if ([parsed.major, parsed.minor, parsed.patch].some((n) => n > MAX_COMPONENT)) {
    return undefined;
  }
  return parsed;
}

/** The four-part Office version for a parsed tag. Always ends in `.0`. */
export function formatProduct(parsed: Parsed): string {
  return `${parsed.major}.${parsed.minor}.${parsed.patch}.${PRODUCT_REVISION}`;
}

/** The npm version for a parsed tag, prerelease suffix included. */
export function formatSemver(parsed: Parsed): string {
  const core = `${parsed.major}.${parsed.minor}.${parsed.patch}`;
  return parsed.prerelease ? `${core}-${parsed.prerelease}` : core;
}

function build(parsed: Parsed, source: string, tagged: boolean): ReleaseVersion {
  const version: ReleaseVersion = {
    semver: formatSemver(parsed),
    product: formatProduct(parsed),
    major: parsed.major,
    minor: parsed.minor,
    patch: parsed.patch,
    source,
    tagged,
  };
  return parsed.prerelease === undefined
    ? version
    : { ...version, prerelease: parsed.prerelease };
}

/** The version in `version.json`: what an untagged build is stamped with. */
export function readBaseline(root: string = ROOT): string {
  const raw = JSON.parse(readFileSync(join(root, "version.json"), "utf8")) as {
    version?: string;
  };
  if (!raw.version) {
    throw new VersionError("version.json has no `version` field.");
  }
  return raw.version;
}

/**
 * Work out what version this build is.
 *
 * In order:
 *
 * 1. `RECITE_VERSION` — set explicitly by the release workflow from
 *    `github.event.release.tag_name`, and useful for testing a release build
 *    locally.
 * 2. `GITHUB_REF_NAME`, when `GITHUB_REF_TYPE` says it is a tag. This covers a
 *    tag pushed without a GitHub release attached.
 * 3. `version.json`.
 *
 * A tag that does not parse is an error rather than a fall-through. Quietly
 * publishing the baseline version under a tag named something else is how a
 * release ends up claiming to be a version it is not.
 */
export function resolveVersion(
  env: NodeJS.ProcessEnv = process.env,
  root: string = ROOT,
): ReleaseVersion {
  const explicit = env.RECITE_VERSION?.trim();
  if (explicit) {
    const parsed = parseVersionTag(explicit);
    if (!parsed) throw unparseable("RECITE_VERSION", explicit);
    return build(parsed, `RECITE_VERSION=${explicit}`, true);
  }

  if (env.GITHUB_REF_TYPE === "tag") {
    const tag = env.GITHUB_REF_NAME?.trim();
    if (tag) {
      const parsed = parseVersionTag(tag);
      if (!parsed) throw unparseable("the release tag", tag);
      return build(parsed, `git tag ${tag}`, true);
    }
  }

  const baseline = readBaseline(root);
  const parsed = parseVersionTag(baseline);
  if (!parsed) throw unparseable("version.json", baseline);
  return build(parsed, "version.json (untagged build)", false);
}

function unparseable(where: string, value: string): VersionError {
  return new VersionError(
    `Cannot read a version from ${where}: ${JSON.stringify(value)}.\n` +
      "Expected MAJOR.MINOR.PATCH with an optional leading `v` and an " +
      "optional prerelease suffix — for example `v1.2.3` or `v1.2.3-rc.1`. " +
      `Each component must be a whole number no greater than ${MAX_COMPONENT}, ` +
      "which is Office's limit for a manifest version component.",
  );
}

/**
 * A prerelease tag produces an Office version indistinguishable from the
 * release it precedes: `v1.2.3-rc.1` and `v1.2.3-rc.2` are both `1.2.3.0`.
 * Word keys upgrades on that number, so it will not see the second as newer.
 * Returned as a string rather than logged here so the caller decides where it
 * goes — a build annotation in CI, a plain line locally.
 */
export function prereleaseWarning(version: ReleaseVersion): string | undefined {
  if (!version.prerelease) return undefined;
  return (
    `Tag carries the prerelease suffix "${version.prerelease}", which the ` +
    `Office manifest cannot express: <Version> will be ${version.product}, ` +
    "the same as every other prerelease of that patch. Word will not treat a " +
    "later one as an upgrade. npm gets the full " +
    `${version.semver}.`
  );
}

function main(): void {
  const version = resolveVersion();
  const warning = prereleaseWarning(version);

  console.log(`semver:  ${version.semver}`);
  console.log(`product: ${version.product}`);
  console.log(`source:  ${version.source}`);
  if (warning) console.warn(`\nwarning: ${warning}`);
}

if (import.meta.url === `file://${process.argv[1]}`) main();

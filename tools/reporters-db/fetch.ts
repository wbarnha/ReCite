/**
 * Fetching the pinned upstream files, and refusing anything unexpected.
 *
 * This runs on a maintainer's machine and in a scheduled CI job — never in a
 * build, and never in a browser. The vendored output is committed, so building
 * ReCite needs no network and produces the same bytes whatever upstream is
 * doing today. That is not incidental: reporter date ranges decide what the
 * date rules call impossible, and a build whose accusations change because
 * someone else pushed a commit is not one anybody should file a brief from.
 */

import { createHash } from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));

export const PIN_PATH = join(HERE, "pin.json");

export interface Pin {
  $comment?: string;
  source: string;
  license: string;
  copyright: string;
  /** A git tag. Immutable, unlike a branch. */
  ref: string;
  syncedAt: string;
  /** Path within the upstream repository to its SHA-256, or null when unpinned. */
  files: Record<string, string | null>;
}

export function readPin(path: string = PIN_PATH): Pin {
  return JSON.parse(readFileSync(path, "utf8")) as Pin;
}

export function writePin(pin: Pin, path: string = PIN_PATH): void {
  writeFileSync(path, `${JSON.stringify(pin, null, 2)}\n`, "utf8");
}

export function sha256(contents: string): string {
  return createHash("sha256").update(contents, "utf8").digest("hex");
}

/**
 * Only the raw file host, and only over HTTPS.
 *
 * A `ref` or path out of the pin becomes part of a URL, so it is worth being
 * explicit that neither can redirect this somewhere else.
 */
const RAW_HOST = "https://raw.githubusercontent.com";
const REPOSITORY = "freelawproject/reporters-db";

export function rawUrl(ref: string, path: string): string {
  for (const part of [ref, path]) {
    // The character check alone is not enough: it permits `.` and `/`, so
    // `../../etc/passwd` passed it. Traversal here would not reach off-host,
    // but a guard that claims to reject something and does not is worse than
    // no guard.
    if (
      /[^\w.\-/]/.test(part) ||
      part.split("/").includes("..") ||
      part.startsWith("/")
    ) {
      throw new Error(
        `Refusing to build a URL from ${JSON.stringify(part)}. ` +
          "A ref is a tag name and a path is a repository-relative file.",
      );
    }
  }
  return `${RAW_HOST}/${REPOSITORY}/${ref}/${path}`;
}

export interface FetchedFile {
  readonly path: string;
  readonly contents: string;
  readonly digest: string;
}

/** Fetch one file at a ref. */
export async function fetchFile(ref: string, path: string): Promise<FetchedFile> {
  const url = rawUrl(ref, path);
  const response = await fetch(url, { redirect: "error" });
  if (!response.ok) {
    throw new Error(`${url} returned ${response.status}.`);
  }
  const contents = await response.text();
  return { path, contents, digest: sha256(contents) };
}

export class DigestMismatch extends Error {
  override readonly name = "DigestMismatch";

  constructor(
    readonly path: string,
    readonly expected: string,
    readonly actual: string,
  ) {
    super(
      `${path} does not match the digest in pin.json.\n` +
        `  expected ${expected}\n  actual   ${actual}\n` +
        "A tag should never change. Either upstream moved it, or the file was " +
        "altered between there and here. Do not update the pin without finding " +
        "out which.",
    );
  }
}

/**
 * Fetch every pinned file and verify it against the pin.
 *
 * `expectMatch: false` is the sync path — the digests are being *recorded*
 * rather than checked. Every other caller wants verification.
 */
export async function fetchPinned(
  pin: Pin,
  { expectMatch = true }: { expectMatch?: boolean } = {},
): Promise<FetchedFile[]> {
  const fetched: FetchedFile[] = [];

  for (const [path, expected] of Object.entries(pin.files)) {
    const file = await fetchFile(pin.ref, path);
    if (expectMatch && expected !== null && file.digest !== expected) {
      throw new DigestMismatch(path, expected, file.digest);
    }
    fetched.push(file);
  }

  return fetched;
}

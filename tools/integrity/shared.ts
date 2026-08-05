/** Shared pieces of the build-integrity tooling. */

import { createHash } from "node:crypto";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { dirname, join, relative, sep } from "node:path";
import { fileURLToPath } from "node:url";

import { resolveVersion } from "../version/resolve.js";

const HERE = dirname(fileURLToPath(import.meta.url));
export const ROOT = join(HERE, "..", "..");
export const DIST = join(ROOT, "apps", "web", "dist");

export const CHECKSUM_FILE = "checksums.sha256";
export const INTEGRITY_FILE = "integrity.json";

/**
 * Files excluded from the manifest of hashes.
 *
 * A checksum file cannot meaningfully contain its own checksum, and
 * `integrity.json` is written after the hashes are computed.
 */
export const SELF_REFERENTIAL = new Set([CHECKSUM_FILE, INTEGRITY_FILE]);

export interface IntegrityManifest {
  readonly version: string;
  readonly commit: string;
  readonly builtAt: string;
  readonly algorithm: "sha256";
  /** Path relative to the site root -> lowercase hex digest. */
  readonly files: Record<string, string>;
}

export function sha256(data: Buffer): string {
  return createHash("sha256").update(data).digest("hex");
}

/** Subresource Integrity digest, as an HTML `integrity` attribute value. */
export function sriHash(data: Buffer): string {
  return `sha384-${createHash("sha384").update(data).digest("base64")}`;
}

/** Every file under `dir`, as site-root-relative POSIX paths, sorted. */
export function listFiles(dir: string): string[] {
  const out: string[] = [];

  const walk = (current: string): void => {
    for (const entry of readdirSync(current)) {
      const full = join(current, entry);
      if (statSync(full).isDirectory()) walk(full);
      else out.push(relative(dir, full).split(sep).join("/"));
    }
  };

  walk(dir);
  return out.sort();
}

export function hashTree(
  dir: string,
  exclude: ReadonlySet<string> = SELF_REFERENTIAL,
): Record<string, string> {
  const files: Record<string, string> = {};
  for (const path of listFiles(dir)) {
    if (exclude.has(path)) continue;
    files[path] = sha256(readFileSync(join(dir, path)));
  }
  return files;
}

/**
 * The `sha256sum` text format, so the published file can be checked with the
 * ordinary system tool and not only with this repository's scripts:
 * `sha256sum -c checksums.sha256`
 */
export function renderChecksumFile(files: Record<string, string>): string {
  return (
    Object.entries(files)
      .map(([path, digest]) => `${digest}  ${path}`)
      .join("\n") + "\n"
  );
}

export function parseChecksumFile(contents: string): Record<string, string> {
  const files: Record<string, string> = {};
  for (const line of contents.split("\n")) {
    const match = /^([0-9a-f]{64}) {2}(.+)$/.exec(line.trim());
    if (match?.[1] && match[2]) files[match[2]] = match[1];
  }
  return files;
}

/** The four-part product version this build is stamped with. */
export function readVersion(): string {
  return resolveVersion().product;
}

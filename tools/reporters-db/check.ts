/**
 * Is upstream ahead of the pin?
 *
 * ```console
 * $ pnpm reporters:check
 * ```
 *
 * Reports and exits 0 whether or not there is drift — this is a notification,
 * not a gate. Deliberately: reporter date ranges decide which citations
 * `DT001` calls impossible, so pulling upstream automatically would mean
 * changing what ReCite accuses people of without anyone reading the diff. What
 * this does is make sure nobody has to remember to look.
 *
 * Two separate questions, and it answers both:
 *
 * 1. **Has a newer version been released?** From upstream's `pyproject.toml`,
 *    which is the only version marker reachable without the GitHub API.
 * 2. **Has the pinned revision itself changed?** It should not — a tag is
 *    immutable — so a digest mismatch here means the tag was moved or the file
 *    was altered, which is a different and more serious thing than being out
 *    of date.
 */

import { fetchFile, fetchPinned, readPin } from "./fetch.js";

const VERSION_FILE = "pyproject.toml";

/** The version upstream's default branch currently declares. */
async function latestVersion(): Promise<string | undefined> {
  const file = await fetchFile("main", VERSION_FILE);
  return /^version\s*=\s*"([^"]+)"/m.exec(file.contents)?.[1];
}

/** `v3.2.66` → `[3, 2, 66]`, for comparison. */
function parts(version: string): number[] {
  return version.replace(/^v/, "").split(".").map(Number);
}

function isNewer(candidate: string, current: string): boolean {
  const a = parts(candidate);
  const b = parts(current);
  for (let i = 0; i < Math.max(a.length, b.length); i++) {
    const left = a[i] ?? 0;
    const right = b[i] ?? 0;
    if (left !== right) return left > right;
  }
  return false;
}

/** Emit a GitHub Actions notice as well as a plain line, when in CI. */
function announce(level: "notice" | "warning", message: string): void {
  console.log(message);
  if (process.env.GITHUB_ACTIONS) console.log(`::${level}::${message}`);
}

async function main(): Promise<void> {
  const pin = readPin();
  console.log(`Pinned at ${pin.ref} (synced ${pin.syncedAt}).`);

  // --- the pinned revision must not have moved --------------------------
  try {
    await fetchPinned(pin);
    console.log("The pinned files still match their recorded digests.");
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error(`\n${message}`);
    if (process.env.GITHUB_ACTIONS) {
      console.log(`::error::The pinned reporters-db revision has changed: ${message}`);
    }
    // This one *is* a failure. A tag that changed under us is not routine.
    process.exit(1);
  }

  // --- and whether there is something newer to move to -------------------
  const latest = await latestVersion();
  if (!latest) {
    announce("warning", "Could not read the upstream version; skipping the check.");
    return;
  }

  if (!isNewer(latest, pin.ref)) {
    console.log(`Upstream is at ${latest}. Nothing newer.`);
    return;
  }

  announce(
    "notice",
    `reporters-db ${latest} is available (pinned at ${pin.ref}). ` +
      `Run \`pnpm reporters:sync --ref v${latest}\` and read the diff: a changed ` +
      "date range changes which citations ReCite reports as impossible.",
  );

  if (process.env.GITHUB_ACTIONS) {
    console.log(
      `\n### reporters-db ${latest} available\n\n` +
        `Pinned at \`${pin.ref}\`.\n\n` +
        "```console\n" +
        `$ pnpm reporters:sync --ref v${latest}\n` +
        "```\n\n" +
        "The sync prints every added, removed and re-dated reporter. " +
        "Read it before committing.\n",
    );
  }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : error);
    process.exit(1);
  });
}

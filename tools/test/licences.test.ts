/**
 * Nothing copyleft reaches a user.
 *
 * ReCite is BSD-2-Clause, and `docs/compliance.md` tells firms in as many
 * words that they may fork, vendor or self-host it on that basis. That
 * sentence was false for a while: the published bundle contained
 * `scribe.js-ocr`, which is AGPL-3.0, and a dependency that ships is
 * distributed whether or not anything reaches it. It was replaced rather than
 * relabelled — see `docs/testing.md` for the measurement that made the
 * replacement safe.
 *
 * This is the guard that keeps it from happening again quietly. A copyleft
 * dependency is easy to add and invisible afterwards: it is one line in a
 * manifest, and the licence text never appears in a diff anyone reads.
 *
 * Scope is runtime dependencies only. A GPL formatter or test runner is not
 * distributed to anyone and is nobody's problem.
 */

import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, "..", "..");
const require = createRequire(import.meta.url);

/** Every workspace manifest whose dependencies end up in a user's browser. */
const SHIPPING = [
  "apps/web",
  "packages/core",
  "packages/rules",
  "packages/engine",
  "packages/courtlistener",
];

interface Manifest {
  readonly name?: string;
  readonly license?: string;
  readonly dependencies?: Record<string, string>;
}

function manifest(path: string): Manifest {
  return JSON.parse(readFileSync(path, "utf8")) as Manifest;
}

/**
 * Licences that impose obligations on whoever distributes the result.
 *
 * The `A` in AGPL is the one that matters most here — it reaches a hosted
 * page, which is exactly what this project is — but any of these would make
 * the BSD-2-Clause claim wrong.
 */
const COPYLEFT = /^(?:A?GPL|LGPL|MPL|EUPL|OSL|CDDL|EPL|CC-BY-SA)/i;

describe("what gets distributed", () => {
  it("declares BSD-2-Clause everywhere", () => {
    const wrong = ["package.json", ...SHIPPING.map((d) => `${d}/package.json`)]
      .map((path) => [path, manifest(join(ROOT, path)).license] as const)
      .filter(([, licence]) => licence !== "BSD-2-Clause");
    expect(wrong).toEqual([]);
  });

  it("finds real dependencies to check", () => {
    // A resolution failure would otherwise make this whole suite vacuous.
    const found = SHIPPING.flatMap((dir) =>
      Object.keys(manifest(join(ROOT, dir, "package.json")).dependencies ?? {}),
    ).filter((name) => !name.startsWith("@recite/"));
    expect(found.length).toBeGreaterThan(2);
    expect(found).toContain("tesseract.js");
    expect(found).toContain("pdfjs-dist");
  });

  it.each(SHIPPING)("%s ships nothing copyleft", (dir) => {
    const deps = Object.keys(
      manifest(join(ROOT, dir, "package.json")).dependencies ?? {},
    );

    const offenders = deps
      .filter((name) => !name.startsWith("@recite/"))
      .map((name) => {
        // Resolved from the installed tree, not from the range in the
        // manifest: the licence of what is actually on disk is the one that
        // gets published.
        const path = require.resolve(`${name}/package.json`, {
          paths: [join(ROOT, dir), ROOT],
        });
        return [name, manifest(path).license ?? "UNDECLARED"] as const;
      })
      .filter(([, licence]) => COPYLEFT.test(licence) || licence === "UNDECLARED");

    expect(offenders).toEqual([]);
  });

  it("recognises the licence it was written to catch", () => {
    // The pattern is the whole test; a typo in it would pass everything.
    expect(COPYLEFT.test("AGPL-3.0")).toBe(true);
    expect(COPYLEFT.test("GPL-3.0-only")).toBe(true);
    expect(COPYLEFT.test("LGPL-2.1")).toBe(true);
    expect(COPYLEFT.test("Apache-2.0")).toBe(false);
    expect(COPYLEFT.test("MIT")).toBe(false);
    expect(COPYLEFT.test("BSD-2-Clause")).toBe(false);
  });
});

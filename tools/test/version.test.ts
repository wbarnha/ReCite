/**
 * Version resolution.
 *
 * The rule these tests exist to hold: a release tag decides the version, npm
 * gets three components, and the Office manifest gets four with the last one
 * always zero. Everything else follows from that.
 */

import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { planChanges } from "../version/apply.js";
import type { ReleaseVersion } from "../version/resolve.js";
import {
  formatProduct,
  parseVersionTag,
  prereleaseWarning,
  PRODUCT_REVISION,
  readBaseline,
  resolveVersion,
  VersionError,
} from "../version/resolve.js";

describe("parseVersionTag", () => {
  it.each([
    ["v1.2.3", 1, 2, 3],
    ["1.2.3", 1, 2, 3],
    ["v0.0.1", 0, 0, 1],
    ["v10.20.30", 10, 20, 30],
    ["v65535.65535.65535", 65535, 65535, 65535],
  ])("reads %s", (tag, major, minor, patch) => {
    expect(parseVersionTag(tag)).toMatchObject({ major, minor, patch });
  });

  it("keeps a prerelease suffix", () => {
    expect(parseVersionTag("v1.2.3-rc.1")).toMatchObject({
      major: 1,
      minor: 2,
      patch: 3,
      prerelease: "rc.1",
    });
  });

  it("accepts but discards build metadata", () => {
    // `+build.5` is not part of the version for either consumer: npm ignores
    // it when ordering and Office has nowhere to put it.
    expect(parseVersionTag("v1.2.3+build.5")).toMatchObject({ patch: 3 });
    expect(parseVersionTag("v1.2.3+build.5")?.prerelease).toBeUndefined();
  });

  it.each([
    ["nightly"],
    ["v1.2"],
    ["v1"],
    ["v1.2.3.4"],
    ["release-1.2.3"],
    ["v1.2.3-"],
    ["va.b.c"],
    [""],
    ["v-1.2.3"],
  ])("refuses %s", (tag) => {
    expect(parseVersionTag(tag)).toBeUndefined();
  });

  it("refuses a component Office cannot hold", () => {
    // Office caps each component of <Version> at 65535.
    expect(parseVersionTag("v65536.0.0")).toBeUndefined();
    expect(parseVersionTag("v1.0.99999")).toBeUndefined();
  });
});

describe("the four-part Office version", () => {
  it("always ends in zero", () => {
    expect(PRODUCT_REVISION).toBe(0);
    for (const tag of ["v1.2.3", "v0.0.1", "v9.9.9", "v1.2.3-rc.1"]) {
      const parsed = parseVersionTag(tag);
      expect(parsed).toBeDefined();
      expect(formatProduct(parsed!)).toMatch(/\.0$/);
    }
  });

  it("is the tag's three numbers plus a zero", () => {
    expect(formatProduct(parseVersionTag("v1.2.3")!)).toBe("1.2.3.0");
    expect(formatProduct(parseVersionTag("v10.20.30")!)).toBe("10.20.30.0");
  });

  it("drops a prerelease suffix, which Office cannot express", () => {
    expect(formatProduct(parseVersionTag("v1.2.3-rc.1")!)).toBe("1.2.3.0");
  });

  it("has exactly four numeric components", () => {
    const product = formatProduct(parseVersionTag("v1.2.3")!);
    expect(product.split(".")).toHaveLength(4);
    expect(product).toMatch(/^\d+\.\d+\.\d+\.\d+$/);
  });
});

describe("resolveVersion", () => {
  const empty: NodeJS.ProcessEnv = {};

  it("takes RECITE_VERSION over everything else", () => {
    const version = resolveVersion({ ...empty, RECITE_VERSION: "v2.3.4" });
    expect(version).toMatchObject({
      semver: "2.3.4",
      product: "2.3.4.0",
      tagged: true,
    });
  });

  it("reads a pushed tag from the Actions environment", () => {
    const version = resolveVersion({
      ...empty,
      GITHUB_REF_TYPE: "tag",
      GITHUB_REF_NAME: "v3.4.5",
    });
    expect(version).toMatchObject({ semver: "3.4.5", product: "3.4.5.0" });
  });

  it("ignores GITHUB_REF_NAME on a branch", () => {
    // Otherwise every push to a branch called `v1.0.0` would claim to be a
    // release of it.
    const version = resolveVersion({
      ...empty,
      GITHUB_REF_TYPE: "branch",
      GITHUB_REF_NAME: "v9.9.9",
    });
    expect(version.tagged).toBe(false);
    expect(version.semver).toBe(readBaseline());
  });

  it("treats an empty RECITE_VERSION as absent", () => {
    // The deploy workflow sets it from `github.event.release.tag_name`, which
    // is the empty string on a push event.
    expect(resolveVersion({ ...empty, RECITE_VERSION: "" }).tagged).toBe(false);
    expect(resolveVersion({ ...empty, RECITE_VERSION: "  " }).tagged).toBe(false);
  });

  it("falls back to the baseline when there is no tag", () => {
    const version = resolveVersion(empty);
    expect(version.tagged).toBe(false);
    expect(version.semver).toBe(readBaseline());
    expect(version.source).toContain("version.json");
  });

  it("refuses a tag it cannot read rather than shipping the baseline", () => {
    expect(() => resolveVersion({ ...empty, RECITE_VERSION: "nightly" })).toThrow(
      VersionError,
    );
    expect(() =>
      resolveVersion({ ...empty, GITHUB_REF_TYPE: "tag", GITHUB_REF_NAME: "latest" }),
    ).toThrow(VersionError);
  });

  it("says what a bad tag should have looked like", () => {
    expect(() => resolveVersion({ ...empty, RECITE_VERSION: "nightly" })).toThrow(
      /v1\.2\.3/,
    );
  });

  it("gives npm the prerelease and Office the plain version", () => {
    const version = resolveVersion({ ...empty, RECITE_VERSION: "v1.2.3-rc.1" });
    expect(version.semver).toBe("1.2.3-rc.1");
    expect(version.product).toBe("1.2.3.0");
  });

  it("records where the version came from", () => {
    expect(resolveVersion({ ...empty, RECITE_VERSION: "v1.2.3" }).source).toContain(
      "RECITE_VERSION",
    );
  });
});

describe("prereleaseWarning", () => {
  it("warns that Word will not see a prerelease as an upgrade", () => {
    const version = resolveVersion({ RECITE_VERSION: "v1.2.3-rc.2" });
    expect(prereleaseWarning(version)).toContain("1.2.3.0");
  });

  it("says nothing about an ordinary release", () => {
    expect(
      prereleaseWarning(resolveVersion({ RECITE_VERSION: "v1.2.3" })),
    ).toBeUndefined();
  });
});

describe("the repository baseline", () => {
  it("parses as a version", () => {
    expect(parseVersionTag(readBaseline())).toBeDefined();
  });

  it("is what an untagged build gets", () => {
    expect(resolveVersion({}).semver).toBe(readBaseline());
  });
});

describe("stamping package.json", () => {
  let root: string;

  const version = (semver: string): ReleaseVersion =>
    resolveVersion({ RECITE_VERSION: semver });

  const manifest = (name: string, ver: string) =>
    `{\n  "name": ${JSON.stringify(name)},\n  "version": ${JSON.stringify(ver)},\n  "private": true\n}\n`;

  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), "recite-version-"));
    for (const [path, name] of [
      ["package.json", "recite-monorepo"],
      ["packages/core/package.json", "@recite/core"],
      ["packages/rules/package.json", "@recite/rules"],
      ["packages/engine/package.json", "@recite/engine"],
      ["apps/web/package.json", "@recite/web"],
    ] as const) {
      const full = join(root, path);
      mkdirSync(dirname(full), { recursive: true });
      writeFileSync(full, manifest(name, "1.0.0"), "utf8");
    }
  });

  afterEach(() => rmSync(root, { recursive: true, force: true }));

  it("plans a change for every manifest that differs", () => {
    const changes = planChanges(version("v2.0.0"), root);
    expect(changes).toHaveLength(5);
    expect(changes.every((c) => c.to === "2.0.0")).toBe(true);
  });

  it("plans nothing when they already match", () => {
    expect(planChanges(version("v1.0.0"), root)).toEqual([]);
  });

  it("uses the three-part form, not the Office one", () => {
    // The npm packages must never see `1.2.3.0`; npm would reject it.
    const changes = planChanges(version("v1.2.3"), root);
    expect(changes.every((c) => c.to === "1.2.3")).toBe(true);
    expect(changes.some((c) => c.to.includes(".0.0.0"))).toBe(false);
  });

  it("carries a prerelease suffix into npm", () => {
    expect(planChanges(version("v1.2.3-rc.1"), root)[0]?.to).toBe("1.2.3-rc.1");
  });

  it("fails loudly on a manifest with no version field", () => {
    writeFileSync(join(root, "packages/core/package.json"), '{"name":"x"}\n', "utf8");
    expect(() => planChanges(version("v2.0.0"), root)).toThrow(/version/);
  });

  it("fails loudly on a missing manifest", () => {
    rmSync(join(root, "packages/rules/package.json"));
    expect(() => planChanges(version("v2.0.0"), root)).toThrow(/not found/);
  });
});

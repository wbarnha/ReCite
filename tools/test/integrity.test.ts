/** The build-verification tooling. */

import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { injectSri } from "../integrity/generate.js";
import {
  hashTree,
  parseChecksumFile,
  renderChecksumFile,
  sha256,
  sriHash,
} from "../integrity/shared.js";
import { verifyTree } from "../integrity/verify.js";
import { renderManifest } from "../manifest/generate.js";

const temporary: string[] = [];

function fixtureDir(files: Record<string, string>): string {
  const dir = mkdtempSync(join(tmpdir(), "recite-integrity-"));
  temporary.push(dir);
  for (const [path, contents] of Object.entries(files)) {
    const full = join(dir, path);
    mkdirSync(join(full, ".."), { recursive: true });
    writeFileSync(full, contents, "utf8");
  }
  return dir;
}

afterEach(() => {
  for (const dir of temporary.splice(0)) rmSync(dir, { recursive: true, force: true });
});

describe("hashing", () => {
  it("produces a stable SHA-256", () => {
    expect(sha256(Buffer.from("recite"))).toMatch(/^[0-9a-f]{64}$/);
    expect(sha256(Buffer.from("recite"))).toBe(sha256(Buffer.from("recite")));
  });

  it("produces an SRI digest in the form browsers expect", () => {
    expect(sriHash(Buffer.from("recite"))).toMatch(/^sha384-[A-Za-z0-9+/]+=*$/);
  });

  it("walks a tree into site-relative paths", () => {
    const dir = fixtureDir({ "index.html": "<p>a</p>", "assets/app.js": "x=1" });
    expect(Object.keys(hashTree(dir)).sort()).toEqual(["assets/app.js", "index.html"]);
  });

  it("excludes the checksum files from their own manifest", () => {
    const dir = fixtureDir({
      "index.html": "<p>a</p>",
      "checksums.sha256": "…",
      "integrity.json": "{}",
    });
    expect(Object.keys(hashTree(dir))).toEqual(["index.html"]);
  });
});

describe("checksum file format", () => {
  it("round-trips through the sha256sum text format", () => {
    const files = { "index.html": "a".repeat(64), "assets/app.js": "b".repeat(64) };
    expect(parseChecksumFile(renderChecksumFile(files))).toEqual(files);
  });

  it("uses two spaces between digest and path, as sha256sum -c requires", () => {
    expect(renderChecksumFile({ "a.js": "c".repeat(64) })).toBe(
      `${"c".repeat(64)}  a.js\n`,
    );
  });

  it("ignores lines that are not digests", () => {
    expect(parseChecksumFile("# a comment\n\nnot a digest\n")).toEqual({});
  });
});

describe("verifyTree", () => {
  it("passes when every file matches", () => {
    const dir = fixtureDir({ "index.html": "<p>a</p>" });
    const report = verifyTree(dir, hashTree(dir));
    expect(report.ok).toBe(true);
    expect(report.checked).toBe(1);
  });

  it("catches a changed file", () => {
    const dir = fixtureDir({ "index.html": "<p>a</p>" });
    const expected = hashTree(dir);
    writeFileSync(join(dir, "index.html"), "<p>tampered</p>", "utf8");

    const report = verifyTree(dir, expected);
    expect(report.ok).toBe(false);
    expect(report.mismatched).toEqual(["index.html"]);
  });

  it("catches a missing file", () => {
    const dir = fixtureDir({ "index.html": "<p>a</p>" });
    const expected = { ...hashTree(dir), "assets/app.js": "d".repeat(64) };

    const report = verifyTree(dir, expected);
    expect(report.missing).toEqual(["assets/app.js"]);
  });

  it("catches a file nobody recorded", () => {
    // Content being served that the build did not produce is as much of a
    // problem as content that changed.
    const dir = fixtureDir({ "index.html": "<p>a</p>" });
    const expected = hashTree(dir);
    writeFileSync(join(dir, "evil.js"), "steal()", "utf8");

    const report = verifyTree(dir, expected);
    expect(report.ok).toBe(false);
    expect(report.unexpected).toEqual(["evil.js"]);
  });
});

describe("injectSri", () => {
  const asset = Buffer.from("console.log(1)");
  const resolve = (url: string) => (url.includes("app") ? asset : undefined);

  it("pins a module script", () => {
    const { html, covered } = injectSri(
      '<script type="module" crossorigin src="/base/assets/app.js"></script>',
      resolve,
    );
    expect(html).toContain(`integrity="${sriHash(asset)}"`);
    expect(covered).toEqual(["/base/assets/app.js"]);
  });

  it("pins a stylesheet", () => {
    const { html } = injectSri(
      '<link rel="stylesheet" href="/base/assets/app.css">',
      () => asset,
    );
    expect(html).toContain("integrity=");
  });

  it("pins a preloaded module", () => {
    // The shared chunk is most of the application and arrives this way; an ES
    // import does not inherit the importing script's integrity.
    const { html } = injectSri(
      '<link rel="modulepreload" crossorigin href="/base/assets/app.js">',
      resolve,
    );
    expect(html).toContain("integrity=");
  });

  it("adds crossorigin when it is absent, as SRI requires", () => {
    const { html } = injectSri('<script src="/base/assets/app.js"></script>', resolve);
    expect(html).toContain('crossorigin="anonymous"');
  });

  it("leaves a cross-origin script alone", () => {
    // Office.js is served by Microsoft and updated by them; pinning it would
    // break the add-in the next time they shipped.
    const tag =
      '<script src="https://appsforoffice.microsoft.com/lib/1/hosted/office.js"></script>';
    expect(injectSri(tag, () => asset).html).toBe(tag);
  });

  it("leaves an already-pinned tag alone", () => {
    const tag =
      '<script src="/base/assets/app.js" integrity="sha384-existing"></script>';
    expect(injectSri(tag, resolve).html).toBe(tag);
  });

  it("skips an asset it cannot resolve", () => {
    const tag = '<script src="/base/assets/missing.js"></script>';
    expect(injectSri(tag, resolve).html).toBe(tag);
  });
});

describe("manifest", () => {
  const manifest = renderManifest({
    baseUrl: "https://example.github.io/ReCite/",
    version: "1.0.0.0",
  });

  it("declares the four-part version Office requires", () => {
    expect(manifest).toContain("<Version>1.0.0.0</Version>");
    expect(/<Version>\d+\.\d+\.\d+\.\d+<\/Version>/.test(manifest)).toBe(true);
  });

  it("points the task pane at the deployment URL", () => {
    expect(manifest).toContain(
      '<SourceLocation DefaultValue="https://example.github.io/ReCite/taskpane.html" />',
    );
  });

  it("declares the origin as an app domain", () => {
    expect(manifest).toContain("<AppDomain>https://example.github.io</AppDomain>");
  });

  it("uses HTTPS for every URL, as Office requires", () => {
    const urls = manifest.match(/DefaultValue="(https?:[^"]+)"/g) ?? [];
    expect(urls.length).toBeGreaterThan(0);
    expect(urls.every((url) => url.includes("https://"))).toBe(true);
  });

  it("asks only for the permission it uses", () => {
    expect(manifest).toContain("<Permissions>ReadWriteDocument</Permissions>");
  });

  it("keeps a stable add-in id across builds", () => {
    const again = renderManifest({
      baseUrl: "https://other.example/x/",
      version: "9.9.9.9",
    });
    const id = (xml: string) => /<Id>([^<]+)<\/Id>/.exec(xml)?.[1];
    expect(id(manifest)).toBe(id(again));
  });

  it("escapes characters that would break the XML", () => {
    const escaped = renderManifest({
      baseUrl: "https://example.test/a&b/",
      version: "1.0.0.0",
    });
    expect(escaped).not.toMatch(/DefaultValue="[^"]*&(?!amp;|quot;|lt;|gt;)/);
  });
});

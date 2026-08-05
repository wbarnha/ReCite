/**
 * The manifest and static pages AppSource will be shown.
 *
 * These assert the things that come back as a store rejection weeks after
 * submission rather than as a build failure — and, for the pages, the claims a
 * law firm's security review will read as commitments.
 */

import { describe, expect, it } from "vitest";

import { renderManifest } from "../manifest/generate.js";
import { urls, validateManifest } from "../manifest/validate.js";
import { renderPage } from "../pages/chrome.js";
import { PAGES } from "../pages/content.js";

const BASE = "https://example.github.io/ReCite/";
const manifest = (version = "1.2.3.0") => renderManifest({ baseUrl: BASE, version });

const errors = (xml: string) =>
  validateManifest(xml).filter((p) => p.severity === "error");
const rules = (xml: string) => new Set(validateManifest(xml).map((p) => p.rule));

describe("the generated manifest passes validation", () => {
  it("has no errors and no warnings", () => {
    expect(validateManifest(manifest())).toEqual([]);
  });
});

describe("version rules", () => {
  it("requires four components", () => {
    expect(rules(manifest("1.2.3"))).toContain("version");
    expect(rules(manifest("1.2"))).toContain("version");
  });

  it("requires the fourth component to be zero", () => {
    // The point of fixing it at zero is that it cannot drift from the release
    // tag; a build that produced anything else has lost that guarantee.
    expect(rules(manifest("1.2.3.4"))).toContain("version");
    expect(validateManifest(manifest("1.2.3.0"))).toEqual([]);
  });

  it("rejects a component Office cannot hold", () => {
    expect(rules(manifest("1.2.70000.0"))).toContain("version");
  });

  it("rejects an unset version", () => {
    expect(rules(manifest("0.0.0.0"))).toContain("version");
  });
});

describe("transport rules", () => {
  it("finds every URL, not just the ones in element text", () => {
    // Regression: an earlier pattern required whitespace after
    // `DefaultValue`, so it matched only `<AppDomain>` and the HTTPS check
    // was inert. Ten URLs, one of which is the app domain.
    const found = urls(manifest());
    expect(found.length).toBeGreaterThan(5);
    expect(found.some((u) => u.endsWith("taskpane.html"))).toBe(true);
    expect(found.some((u) => u.endsWith(".png"))).toBe(true);
  });

  it("rejects plain HTTP anywhere", () => {
    const downgraded = manifest().replace(
      "https://example.github.io/ReCite/taskpane",
      "http://example.github.io/ReCite/taskpane",
    );
    expect(rules(downgraded)).toContain("https");
  });

  it("rejects a development host", () => {
    expect(
      rules(renderManifest({ baseUrl: "https://localhost:3000/", version: "1.0.0.0" })),
    ).toContain("https");
  });
});

describe("listing rules", () => {
  it("keeps the description within the store limit", () => {
    const description =
      /Description DefaultValue="([^"]*)"/.exec(manifest())?.[1] ?? "";
    expect(description.length).toBeGreaterThan(30);
    expect(description.length).toBeLessThanOrEqual(250);
  });

  it("requires a support URL", () => {
    expect(rules(manifest().replace(/<SupportUrl[^>]*\/>/, ""))).toContain(
      "support-url",
    );
  });

  it("requires a GUID identity", () => {
    expect(
      rules(manifest().replace(/<Id>[^<]*<\/Id>/, "<Id>not-a-guid</Id>")),
    ).toContain("id");
  });

  it("points the store icons at the sizes the store wants", () => {
    // 64 and 128 are the listing icons; 16/32/80 are the ribbon, which is a
    // different set for a different purpose.
    expect(manifest()).toContain("icons/icon-64.png");
    expect(manifest()).toContain("icons/icon-128.png");
  });

  it("names the publisher AppSource will check against the account", () => {
    // A provider name that does not match the Partner Center account is a
    // rejection, and it is the kind that is only discovered after the wait.
    expect(manifest()).toContain("<ProviderName>William Barnhart</ProviderName>");
  });

  it("asks only for the permission it needs", () => {
    expect(manifest()).toContain("<Permissions>ReadWriteDocument</Permissions>");
    expect(errors(manifest())).toEqual([]);
  });
});

describe("the static pages", () => {
  const rendered = PAGES.map((page) => [page.file, renderPage(page)] as const);

  it("publishes the three pages AppSource requires", () => {
    expect(PAGES.map((p) => p.file).sort()).toEqual([
      "privacy.html",
      "support.html",
      "terms.html",
    ]);
  });

  it.each(rendered)("%s is self-contained", (_file, html) => {
    // No scripts, no external stylesheet, no fonts, no remote images. A
    // compliance page that fails to render because an asset moved would be
    // worse than a plain one — and `default-src 'none'` is only credible if
    // there is genuinely nothing to load.
    expect(html).not.toMatch(/<script/i);
    expect(html).not.toMatch(/<link[^>]+rel=["']stylesheet/i);
    expect(html).not.toMatch(/src=["']https?:/i);
    expect(html).not.toMatch(/@import/i);
  });

  it.each(rendered)("%s declares a restrictive policy", (_file, html) => {
    expect(html).toContain("default-src 'none'");
    expect(html).toContain("script-src 'none'");
    expect(html).toContain("connect-src 'none'");
  });

  it.each(rendered)("%s is a complete document", (_file, html) => {
    expect(html.startsWith("<!doctype html>")).toBe(true);
    expect(html).toMatch(/<title>[^<]+<\/title>/);
    expect(html).toContain('lang="en"');
    expect(html).toMatch(/<h1>[^<]+<\/h1>/);
  });

  it("states the guarantee the whole design rests on", () => {
    const privacy = rendered.find(([file]) => file === "privacy.html")?.[1] ?? "";
    expect(privacy).toMatch(/connect-src 'none'/);
    expect(privacy).toMatch(/never (?:uploaded|transmitted)/i);
    // The two parties that genuinely can observe a request must be named
    // rather than glossed. A privacy policy that overclaims is worse than one
    // that admits a boundary.
    expect(privacy).toMatch(/GitHub/);
    expect(privacy).toMatch(/Microsoft/);
  });

  it("does not promise the tool verifies a case exists", () => {
    const terms = rendered.find(([file]) => file === "terms.html")?.[1] ?? "";
    expect(terms).toMatch(/not a guarantee/i);
    expect(terms).toMatch(/fabricated/i);
  });

  it("escapes interpolated text", () => {
    const html = renderPage({
      file: "x.html",
      title: "</title><script>alert(1)</script>",
      heading: "<img onerror=1>",
      body: "<p>safe</p>",
    });
    expect(html).not.toMatch(/<script>alert/);
    expect(html).not.toMatch(/<img onerror/);
    expect(html).toContain("&lt;script&gt;");
  });
});

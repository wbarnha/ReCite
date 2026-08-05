/**
 * The claims ReCite makes in public, checked against what it ships.
 *
 * `privacy.html`, `docs/compliance.md` and the AppSource listing all tell a
 * law firm that no document text leaves the page. That is the reason anyone
 * would let this near a privileged document, so it should not rest on someone
 * remembering it during review. These tests read the actual HTML and the
 * actual bundle entry points.
 *
 * A failure here is not a style problem. It means a published privacy claim
 * has become untrue.
 */

import { readdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, "..", "..");
const WEB = join(ROOT, "apps", "web");

const read = (path: string) => readFileSync(path, "utf8");
const indexHtml = read(join(WEB, "index.html"));
const taskpaneHtml = read(join(WEB, "taskpane.html"));

/** Every `.ts`/`.tsx` file that ends up in the browser bundle. */
function sourceFiles(): string[] {
  const found: string[] = [];
  const walk = (dir: string): void => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const full = join(dir, entry.name);
      if (entry.isDirectory()) walk(full);
      else if (/\.tsx?$/.test(entry.name)) found.push(full);
    }
  };
  walk(join(WEB, "src"));
  for (const pkg of ["core", "rules", "engine"]) {
    walk(join(ROOT, "packages", pkg, "src"));
  }
  return found;
}

const SHIPPED = sourceFiles().map(
  (path) => [path.slice(ROOT.length + 1), read(path)] as const,
);

describe("nothing in the shipped code can transmit or persist", () => {
  it("finds the source to check", () => {
    expect(SHIPPED.length).toBeGreaterThan(15);
  });

  // Each of these would break a specific published sentence.
  const FORBIDDEN: ReadonlyArray<readonly [string, RegExp]> = [
    ["XMLHttpRequest", /\bXMLHttpRequest\b/],
    ["WebSocket", /\bWebSocket\b/],
    ["sendBeacon", /\bsendBeacon\b/],
    ["EventSource", /\bEventSource\b/],
    ["localStorage", /\blocalStorage\b/],
    ["sessionStorage", /\bsessionStorage\b/],
    ["indexedDB", /\bindexedDB\b/i],
    ["document.cookie", /document\s*\.\s*cookie/],
    ["navigator.geolocation", /\bgeolocation\b/],
  ];

  it.each(FORBIDDEN)("no %s anywhere in what ships", (_name, pattern) => {
    const offenders = SHIPPED.filter(([, contents]) => pattern.test(contents)).map(
      ([path]) => path,
    );
    expect(offenders).toEqual([]);
  });

  it("uses fetch in exactly one place, for a file published with the app", () => {
    // The claim was never "no fetch" — it is that nothing leaves the origin.
    // The example filing is served from this origin and loading it is a
    // request the user asked for by pressing a button. Pinning the call site
    // means a second one has to be argued for rather than added quietly.
    const callers = SHIPPED.filter(([, contents]) => /\bfetch\s*\(/.test(contents)).map(
      ([path]) => path,
    );
    expect(callers).toEqual(["apps/web/src/example.ts"]);
  });

  it("builds that one URL relative to the page, so it cannot point elsewhere", () => {
    const example = SHIPPED.find(([path]) => path.endsWith("example.ts"))?.[1] ?? "";
    expect(example).toContain("document.baseURI");
    // No absolute URL anywhere in it.
    expect(example).not.toMatch(/fetch\s*\(\s*["'`]https?:/);
  });
});

describe("the Content Security Policy backs the claim", () => {
  const csp = (html: string) =>
    /http-equiv="Content-Security-Policy"\s*content="([^"]*)"/.exec(html)?.[1] ?? "";

  it("the task pane forbids opening any connection at all", () => {
    // The strictest of the two, and it stays that way: the task pane runs on
    // an open client document inside Word, and it has no OCR to load because
    // Word supplies the text.
    expect(csp(taskpaneHtml)).toContain("connect-src 'none'");
  });

  it("the web app allows connections to its own origin and nowhere else", () => {
    // Relaxed from 'none' when in-browser OCR arrived: a WebAssembly engine
    // has to be fetched before it can run. `'self'` keeps the guarantee that
    // actually matters — the browser still refuses every cross-origin
    // request, so document text cannot leave the machine.
    const directive = /connect-src ([^;]*)/.exec(csp(indexHtml))?.[1]?.trim();
    expect(directive).toBe("'self'");
  });

  it("neither page allows a connection to any external origin", () => {
    for (const html of [indexHtml, taskpaneHtml]) {
      const directive = /connect-src ([^;]*)/.exec(csp(html))?.[1] ?? "";
      expect(directive).not.toMatch(/https?:/);
      expect(directive).not.toContain("*");
    }
  });

  it.each([
    ["index.html", indexHtml],
    ["taskpane.html", taskpaneHtml],
  ])("%s denies everything not explicitly allowed", (_file, html) => {
    expect(csp(html)).toContain("default-src 'none'");
    expect(csp(html)).toContain("form-action 'none'");
    expect(csp(html)).toContain("base-uri 'none'");
  });
});

describe("office.js is confined to the Word task pane", () => {
  /**
   * Read `script-src` out of the policy itself.
   *
   * Reading it out of the whole file matched the prose in an HTML comment
   * above the policy instead — the comment quotes the directive it is
   * explaining. A test that greps a document for a directive name will find
   * the documentation of it.
   */
  const scriptSrc = (html: string): string => {
    const policy =
      /http-equiv="Content-Security-Policy"\s*content="([^"]*)"/.exec(html)?.[1] ?? "";
    return (/script-src ([^;]*)/.exec(policy)?.[1] ?? "").trim();
  };

  it("the web app does not load it", () => {
    // Published in privacy.html: "The web app does not load office.js at all
    // — that request happens only inside Microsoft Word."
    expect(indexHtml).not.toMatch(/<script[^>]+appsforoffice/i);
  });

  it("the web app's policy would not permit it to", () => {
    // Stronger than the above and the reason this test exists: even a bug or
    // a tampered bundle cannot make the web app reach Microsoft, because the
    // browser will refuse.
    //
    // Asserted as "no external host" rather than as an exact string, because
    // the directive legitimately gained `'wasm-unsafe-eval'` when in-browser
    // OCR arrived. Pinning the whole value would have failed on a change that
    // does not weaken the claim, and the claim is about hosts.
    const directive = scriptSrc(indexHtml);
    expect(directive).toContain("'self'");
    expect(directive).not.toMatch(/https?:/);
    expect(directive).not.toContain("appsforoffice");
    expect(directive).not.toContain("'unsafe-inline'");
    expect(directive).not.toContain("'unsafe-eval'");
  });

  it("the task pane does load it, from Microsoft's own origin", () => {
    // Office requires this rather than allowing it to be bundled, so the task
    // pane is the one place an external request is legitimate.
    expect(taskpaneHtml).toMatch(
      /<script[^>]+src="https:\/\/appsforoffice\.microsoft\.com\/lib\/1\/hosted\/office\.js"/,
    );
    expect(scriptSrc(taskpaneHtml)).toContain("https://appsforoffice.microsoft.com");
  });

  it("is the only external origin either page permits", () => {
    for (const html of [indexHtml, taskpaneHtml]) {
      const csp = /content="([^"]*)"/.exec(html)?.[1] ?? "";
      const origins = [...csp.matchAll(/https?:\/\/[^\s;"]+/g)].map((m) => m[0]);
      expect(new Set(origins).size).toBeLessThanOrEqual(1);
      for (const origin of origins) {
        expect(origin).toBe("https://appsforoffice.microsoft.com");
      }
    }
  });
});

describe("no analytics or telemetry", () => {
  /**
   * Matched as hostnames, not as substrings.
   *
   * The substring version of this test failed on `implausible-year`, which
   * contains the name of an analytics vendor. A tracker is a host you send
   * something to, so that is what to look for — and a check that cries wolf
   * on a rule name is a check people learn to switch off.
   */
  const TRACKER_HOSTS = [
    "google-analytics.com",
    "googletagmanager.com",
    "api.segment.io",
    "api.mixpanel.com",
    "ingest.sentry.io",
    "plausible.io",
    "static.hotjar.com",
    "app.posthog.com",
    "browser-intake-datadoghq.com",
  ];

  const references = (text: string) =>
    TRACKER_HOSTS.filter((host) => text.toLowerCase().includes(host));

  it.each([
    ["index.html", indexHtml],
    ["taskpane.html", taskpaneHtml],
  ])("%s references no tracker", (_file, html) => {
    expect(references(html)).toEqual([]);
  });

  it("no tracker is referenced in the shipped source either", () => {
    const offenders = SHIPPED.filter(([, contents]) => references(contents).length > 0);
    expect(offenders.map(([path]) => path)).toEqual([]);
  });

  it("no shipped file names any host but Microsoft's", () => {
    // Broader than a blocklist, which only catches vendors someone thought of.
    const offenders: string[] = [];
    for (const [path, contents] of SHIPPED) {
      for (const match of contents.matchAll(/https?:\/\/([a-z0-9.-]+)/gi)) {
        const host = match[1]?.toLowerCase() ?? "";
        // Namespace identifiers, not addresses: w3.org for XML, and
        // openxmlformats.org for the `.docx` writer. Nothing fetches them —
        // they are the names OOXML and ODF give their vocabularies.
        if (host.endsWith("w3.org") || host.endsWith("openxmlformats.org")) continue;
        if (host === "appsforoffice.microsoft.com") continue;
        if (host.endsWith("github.com") || host.endsWith("github.io")) continue;
        offenders.push(`${path}: ${host}`);
      }
    }
    expect(offenders).toEqual([]);
  });
});

describe("the compliance document stays honest about SOC 2", () => {
  const compliance = read(join(ROOT, "docs", "compliance.md"));

  it("does not claim to be SOC 2 compliant", () => {
    // The whole point of that section. A project with no organisation and no
    // customer data cannot hold an attestation about a service organisation's
    // controls, and saying otherwise to a law firm would be a lie with
    // consequences.
    expect(compliance).toMatch(/does not have a SOC 2 report, and cannot have one/i);
    expect(compliance).not.toMatch(/we are SOC 2 (?:compliant|certified)/i);
    expect(compliance).not.toMatch(/ReCite is SOC 2/i);
  });

  it("states the limitations, not only the strengths", () => {
    expect(compliance).toMatch(/What ReCite does not protect you from/);
    // Phrased loosely on purpose: this asserts the admission is present, not
    // how it is punctuated. A test that pins prose formatting fails on a
    // reflow and teaches people to stop reading it.
    expect(compliance).toMatch(/penetration tested/i);
    expect(compliance).toMatch(/Not by a third party/i);
    expect(compliance).toMatch(/indemnify you, no contract/i);
    expect(compliance).toMatch(/clean report is not a verification/i);
  });

  it("names the parties that can observe a request", () => {
    expect(compliance).toMatch(/GitHub/);
    expect(compliance).toMatch(/Microsoft/);
  });
});

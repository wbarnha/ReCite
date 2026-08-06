/**
 * The claims ReCite makes in public, checked against what it ships.
 *
 * `privacy.html`, `docs/compliance.md` and the AppSource listing all tell a
 * law firm what does and does not leave the page. That is the reason anyone
 * would let this near a privileged document, so it should not rest on someone
 * remembering it during review. These tests read the actual HTML and the
 * actual bundle entry points.
 *
 * The claim they hold has one exception now, and it is stated precisely
 * because a vague version would be worse than none: **document text never
 * leaves the page, and the only host either page can reach besides its own is
 * CourtListener, which receives a volume, a reporter and a page.** Everything
 * below exists to make a change to that sentence fail a build rather than pass
 * a review.
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
  for (const pkg of ["core", "rules", "engine", "courtlistener"]) {
    walk(join(ROOT, "packages", pkg, "src"));
  }
  return found;
}

/**
 * Source with comments removed.
 *
 * The scans below look for an API being *reachable*, and a comment cannot
 * reach anything. Scanning raw text instead would mean the code could not
 * explain its own restraint — `import/cache.ts` says in prose why it holds
 * nothing in IndexedDB, and that sentence is worth more than the false
 * positive it used to cause.
 */
function withoutComments(source: string): string {
  return source
    .replace(/\/\*[\s\S]*?\*\//g, " ")
    .replace(/(^|[^:"'`\\])\/\/.*$/gm, "$1");
}

const SHIPPED = sourceFiles().map(
  (path) => [path.slice(ROOT.length + 1), withoutComments(read(path))] as const,
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

  /**
   * Every place the app is allowed to open a request, and why.
   *
   * Pinning the call sites means a new one has to be argued for here, in
   * writing, rather than added quietly. That is deliberately annoying: this
   * list is the shape of the product's promise, and it should cost a
   * paragraph to change.
   */
  const SAME_ORIGIN_FETCH: ReadonlyArray<readonly [string, string]> = [
    [
      "apps/web/src/example.ts",
      "the example filing, fetched because the user pressed a button",
    ],
    [
      "apps/web/src/import/warmup.ts",
      "the OCR language model, fetched early so opening a scan is faster",
    ],
  ];

  /**
   * The one place a request may leave this origin, and the conditions on it.
   *
   * `authority.ts` is a one-line wrapper around `fetch` handed to the
   * CourtListener client, which is where the URL is actually built. The
   * wrapper exists so that this list stays a list of files someone can read
   * in a minute.
   */
  const OFF_ORIGIN_FETCH: ReadonlyArray<readonly [string, string]> = [
    [
      "apps/web/src/authority.ts",
      "CourtListener, and only once the user has pasted an API token",
    ],
  ];

  const FETCH_SITES = [...SAME_ORIGIN_FETCH, ...OFF_ORIGIN_FETCH];

  it("opens requests only from the places argued for above", () => {
    const callers = SHIPPED.filter(([, contents]) => /\bfetch\s*\(/.test(contents))
      .map(([path]) => path)
      .sort();
    expect(callers).toEqual(FETCH_SITES.map(([path]) => path).sort());
  });

  it.each(SAME_ORIGIN_FETCH)(
    "%s builds its URL relative to the page, so it cannot point elsewhere",
    (path) => {
      const source = SHIPPED.find(([name]) => name === path)?.[1] ?? "";
      expect(source, `${path} was not found`).not.toBe("");
      expect(source).toContain("document.baseURI");
      // No absolute URL anywhere in the code — comments are already stripped.
      expect(source).not.toMatch(/https?:\/\//);
    },
  );

  it.each(OFF_ORIGIN_FETCH)("%s names no host of its own", (path) => {
    // The wrapper must not be where a URL is decided. Every address the
    // client can reach comes from the fixed origin in `http.ts`, so a value
    // derived from a document cannot redirect a request.
    const source = SHIPPED.find(([name]) => name === path)?.[1] ?? "";
    expect(source, `${path} was not found`).not.toBe("");
    expect(source).not.toMatch(/https?:\/\//);
  });

  it("hard-codes the only external host it can reach, in one place", () => {
    const hosts = SHIPPED.filter(([, contents]) =>
      /https:\/\/www\.courtlistener\.com/.test(contents),
    ).map(([path]) => path);
    expect(hosts).toEqual(["packages/courtlistener/src/http.ts"]);
  });

  it("builds a request body out of citation components and nothing else", () => {
    // The endpoint also accepts a `text` field, which would be fewer requests
    // and would post a client's brief to a third party. The unit tests in
    // `packages/courtlistener` assert the behaviour; this asserts the shape of
    // the code, so that a branch adding a fourth field is visible here too.
    const lookup =
      SHIPPED.find(([path]) => path === "packages/courtlistener/src/lookup.ts")?.[1] ??
      "";
    expect(lookup).not.toBe("");
    const form =
      /export function buildLookupForm\([\s\S]*?\n\}/.exec(lookup)?.[0] ?? "";
    expect(form).not.toBe("");
    expect([...form.matchAll(/^\s{4}(\w+):/gm)].map((m) => m[1])).toEqual([
      "volume",
      "reporter",
      "page",
    ]);
  });
});

describe("the Content Security Policy backs the claim", () => {
  const csp = (html: string) =>
    /http-equiv="Content-Security-Policy"\s*content="([^"]*)"/.exec(html)?.[1] ?? "";
  const connectSrc = (html: string) =>
    (/connect-src ([^;]*)/.exec(csp(html))?.[1] ?? "").trim();

  /** The only external host either page may name, anywhere in its policy. */
  const COURTLISTENER = "https://www.courtlistener.com";

  it("the task pane can reach CourtListener and nothing else — not even itself", () => {
    // Still the stricter of the two, and deliberately: Word hands the pane the
    // document, so the pane has nothing of its own to load. `'self'` is
    // *absent*, which means a bundled bug has no same-origin endpoint to post
    // to either.
    expect(connectSrc(taskpaneHtml)).toBe(COURTLISTENER);
  });

  it("the web app allows its own origin and CourtListener, in that order", () => {
    // `'self'` because in-browser OCR has to fetch a WebAssembly engine before
    // it can run; CourtListener because a citation can only be verified
    // against something that holds case law.
    expect(connectSrc(indexHtml)).toBe(`'self' ${COURTLISTENER}`);
  });

  it("neither page permits a wildcard or a second external origin", () => {
    // The guarantee that survives: these are the only hosts the browser will
    // let either page reach at all.
    for (const html of [indexHtml, taskpaneHtml]) {
      const directive = connectSrc(html);
      expect(directive).not.toContain("*");
      const hosts = [...directive.matchAll(/https?:\/\/\S+/g)].map((m) => m[0]);
      expect(hosts).toEqual([COURTLISTENER]);
    }
  });

  it("does not let the connection open itself", () => {
    // A CSP entry is permission, not behaviour. Nothing is sent until a token
    // is supplied, and the client refuses to exist without one.
    const http =
      SHIPPED.find(([path]) => path === "packages/courtlistener/src/http.ts")?.[1] ??
      "";
    expect(http).toContain("A CourtListener API token is required");
    expect(http).toContain("ReCite makes no anonymous requests");
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

  it("is one of exactly two external origins either page permits", () => {
    // Two, named, and both argued for in the HTML comment above the policy.
    // Anything else is a rejection, not a review comment.
    const ALLOWED = new Set([
      "https://appsforoffice.microsoft.com",
      "https://www.courtlistener.com",
    ]);
    for (const html of [indexHtml, taskpaneHtml]) {
      const csp = /content="([^"]*)"/.exec(html)?.[1] ?? "";
      const origins = [...csp.matchAll(/https?:\/\/[^\s;"]+/g)].map((m) => m[0]);
      expect(new Set(origins).size).toBeLessThanOrEqual(2);
      for (const origin of origins) expect(ALLOWED).toContain(origin);
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

  it("no shipped file names a host that is not accounted for", () => {
    // Broader than a blocklist, which only catches vendors someone thought of.
    const offenders: string[] = [];
    for (const [path, contents] of SHIPPED) {
      for (const match of contents.matchAll(/https?:\/\/([a-z0-9.-]+)/gi)) {
        const host = match[1]?.toLowerCase() ?? "";
        // Namespace identifiers, not addresses: w3.org and purl.org for XML
        // and Dublin Core, openxmlformats.org for the `.docx` writer. Nothing
        // fetches them — they are the names OOXML and ODF give their
        // vocabularies.
        if (
          host.endsWith("w3.org") ||
          host.endsWith("purl.org") ||
          host.endsWith("openxmlformats.org")
        ) {
          continue;
        }
        if (host === "appsforoffice.microsoft.com") continue;
        // The one service ReCite can call, and only with a token. The test
        // above pins it to a single file so it cannot spread.
        if (host === "www.courtlistener.com") continue;
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

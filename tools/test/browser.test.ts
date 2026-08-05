/**
 * The built site, in a real browser.
 *
 * Everything else in this repository tests modules. This tests the artefact
 * that is actually published, in the engine that will actually run it, because
 * two of the claims ReCite makes cannot be checked any other way:
 *
 * - **OCR works.** Not "the code that calls the OCR library is well typed" —
 *   that a scanned page, with no text layer at all, comes back as readable
 *   citations.
 * - **Nothing leaves the origin.** Scribe's default is to fetch language
 *   models from jsDelivr, and the string is still in the bundle because it is
 *   the fallback. The only way to know the override took is to watch the
 *   network.
 *
 * Skipped when Chromium is not available, so a contributor without it can
 * still run the suite — but CI has it, and CI is where this has to pass.
 */

import { createServer, type Server } from "node:http";
import { readFileSync, existsSync } from "node:fs";
import { extname, join, normalize } from "node:path";
import { dirname } from "node:path";
import { fileURLToPath } from "node:url";

import type * as playwrightTypes from "playwright";
import type { Browser, Page } from "playwright";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { makeScannedPdf } from "./helpers/scanned-pdf.js";

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, "..", "..");
const DIST = join(ROOT, "apps", "web", "dist");

/** The site is served from a sub-path on Pages, so the test does too. */
const BASE_PATH = "/ReCite/";

const MIME: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".wasm": "application/wasm",
  ".json": "application/json",
  ".png": "image/png",
  ".gz": "application/gzip",
  ".xml": "application/xml",
  ".map": "application/json",
};

/** Pre-installed by the environment; Playwright is told not to download one. */
const CHROMIUM = "/opt/pw-browsers/chromium-1194/chrome-linux/chrome";

const built = existsSync(join(DIST, "index.html")) && existsSync(CHROMIUM);
/** Imported dynamically so the suite still loads where Playwright is absent. */
let playwright: typeof playwrightTypes | undefined;
try {
  playwright = await import("playwright");
} catch {
  playwright = undefined;
}

const runnable = built && playwright !== undefined;

/** Serve `dist/` under the same sub-path GitHub Pages uses. */
function serve(): Promise<{ server: Server; origin: string }> {
  const server = createServer((request, response) => {
    const url = new URL(request.url ?? "/", "http://localhost");
    let path = decodeURIComponent(url.pathname);

    if (!path.startsWith(BASE_PATH)) {
      response.writeHead(404).end("outside the base path");
      return;
    }
    path = path.slice(BASE_PATH.length) || "index.html";

    // The served tree is a fixture, but treating a request path as safe is a
    // habit worth not having.
    const target = join(DIST, normalize(path).replace(/^(?:\.\.[/\\])+/, ""));
    if (!target.startsWith(DIST) || !existsSync(target)) {
      response.writeHead(404).end("not found");
      return;
    }

    response.writeHead(200, {
      "Content-Type": MIME[extname(target)] ?? "application/octet-stream",
      // Scribe's workers want these for SharedArrayBuffer; harmless otherwise.
      "Cross-Origin-Opener-Policy": "same-origin",
      "Cross-Origin-Embedder-Policy": "require-corp",
      "Cross-Origin-Resource-Policy": "same-origin",
    });
    response.end(readFileSync(target));
  });

  return new Promise((resolve) => {
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      const port = typeof address === "object" && address ? address.port : 0;
      resolve({ server, origin: `http://127.0.0.1:${port}` });
    });
  });
}

describe.skipIf(!runnable)("the published site in a browser", () => {
  let server: Server;
  let origin: string;
  let browser: Browser;

  /** Every URL the page asked for, in order. */
  let requested: string[] = [];

  beforeAll(async () => {
    ({ server, origin } = await serve());
    browser = await playwright!.chromium.launch({
      executablePath: CHROMIUM,
      args: ["--no-sandbox"],
    });
  }, 120_000);

  afterAll(async () => {
    await browser?.close();
    server?.close();
  });

  async function open() {
    const page = await browser.newPage();
    requested = [];
    page.on("request", (request) => requested.push(request.url()));
    const errors: string[] = [];
    page.on("pageerror", (error) => errors.push(error.message));
    await page.goto(`${origin}${BASE_PATH}`, { waitUntil: "networkidle" });
    return { page, errors };
  }

  /** Requests to anywhere but the test server. */
  const offOrigin = () =>
    requested.filter(
      (url) =>
        !url.startsWith(origin) && !url.startsWith("data:") && !url.startsWith("blob:"),
    );

  /**
   * Wait for an element's text or value to match.
   *
   * Polled through Playwright's typed API rather than by evaluating a function
   * in the page: the page-side version needs DOM types, and pulling the DOM
   * lib into this project would let a Node build tool reference `document` and
   * still typecheck.
   */
  async function waitForMatch(
    page: Page,
    selector: string,
    pattern: RegExp,
    timeout: number,
  ): Promise<string> {
    const locator = page.locator(selector).first();
    const deadline = Date.now() + timeout;
    let last = "";

    while (Date.now() < deadline) {
      last =
        (await locator.inputValue().catch(() => null)) ??
        (await locator.textContent().catch(() => null)) ??
        "";
      if (pattern.test(last)) return last;
      await new Promise((resolve) => setTimeout(resolve, 250));
    }

    throw new Error(
      `${selector} never matched ${String(pattern)} within ${timeout}ms. ` +
        `Last value: ${JSON.stringify(last.slice(0, 200))}`,
    );
  }

  it("loads with no console errors and no external requests", async () => {
    const { page, errors } = await open();
    expect(await waitForMatch(page, "h1", /^ReCite$/, 20_000)).toBe("ReCite");
    expect(errors).toEqual([]);
    expect(offOrigin()).toEqual([]);
    await page.close();
  }, 60_000);

  it("does not download the OCR engine unless a PDF is opened", async () => {
    // Tens of megabytes. If this regresses, every visitor pays for a feature
    // most of them never use.
    const { page } = await open();
    const engineRequests = requested.filter((url) => /\.wasm$|traineddata/.test(url));
    expect(engineRequests).toEqual([]);
    await page.close();
  }, 60_000);

  it("checks a pasted citation", async () => {
    const { page } = await open();
    await page.fill(
      "textarea",
      "Miller v. United Airlines, Inc., 174 F.3d 366, 371-372 (2d Cir. 1999).",
    );
    await page.click("button:has-text('Check citations')");
    expect(await waitForMatch(page, ".status", /citation/i, 20_000)).toMatch(
      /citation/i,
    );
    await page.close();
  }, 60_000);

  it("opens a .txt file by drag-and-drop target", async () => {
    const { page } = await open();
    await page.setInputFiles("input[type=file]", {
      name: "brief.txt",
      mimeType: "text/plain",
      buffer: Buffer.from("Iqbal, 556 U.S. 662, 678 (2009). Id. at 680."),
    });
    expect(await waitForMatch(page, "textarea", /Iqbal/, 20_000)).toContain("Iqbal");
    expect(offOrigin()).toEqual([]);
    await page.close();
  }, 60_000);

  it("reads a scanned PDF with OCR, and asks nobody for help", async () => {
    // The fixture is a photograph of text: no text layer, nothing selectable.
    // This is the case the whole feature exists for.
    const pdf = await makeScannedPdf(browser, [
      "Miller v. United Airlines, Inc., 174 F.3d 366 (2d Cir. 1999).",
      "See also Iqbal, 556 U.S. 662 (2009).",
    ]);

    const { page } = await open();
    await page.setInputFiles("input[type=file]", {
      name: "scanned.pdf",
      mimeType: "application/pdf",
      buffer: pdf,
    });

    // OCR is slow; the status line is what tells the user it is working.
    // Character-level accuracy is not asserted — OCR is a guess and the point
    // is that recognisable citation text comes back at all.
    const recognised = await waitForMatch(
      page,
      "textarea",
      /F\.?\s?3d|366|Miller/i,
      240_000,
    );
    expect(recognised.length).toBeGreaterThan(20);

    // The claim that matters: the models were served from this origin, not
    // from jsDelivr, even though the fallback string is still in the bundle.
    expect(offOrigin()).toEqual([]);
    expect(requested.some((url) => url.includes("traineddata"))).toBe(true);

    await page.close();
  }, 300_000);
});

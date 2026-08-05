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

import { type Server } from "node:http";

import type * as playwrightTypes from "playwright";
import type { Browser, Page } from "playwright";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { makeScannedPdf } from "./helpers/scanned-pdf.js";
import { BASE_PATH, CHROMIUM, serveSite, siteIsBuilt } from "./helpers/site-server.js";

const built = siteIsBuilt();
/** Imported dynamically so the suite still loads where Playwright is absent. */
let playwright: typeof playwrightTypes | undefined;
try {
  playwright = await import("playwright");
} catch {
  playwright = undefined;
}

const runnable = built && playwright !== undefined;

describe.skipIf(!runnable)("the published site in a browser", () => {
  let server: Server;
  let origin: string;
  let browser: Browser;

  /** Every URL the page asked for, in order. */
  let requested: string[] = [];

  beforeAll(async () => {
    ({ server, origin } = await serveSite());
    browser = await playwright!.chromium.launch({
      executablePath: CHROMIUM,
      args: ["--no-sandbox"],
    });
  }, 120_000);

  afterAll(async () => {
    await browser?.close();
    server?.close();
  });

  async function open(query = "") {
    const page = await browser.newPage();
    requested = [];
    page.on("request", (request) => requested.push(request.url()));
    const errors: string[] = [];
    page.on("pageerror", (error) => errors.push(error.message));
    await page.goto(`${origin}${BASE_PATH}${query}`, { waitUntil: "networkidle" });
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

  it("offers the edition and the Bluepages/Whitepages rule set", async () => {
    // Both settings change what gets reported, so both have to be reachable
    // and have to be labelled the way the book labels them — a lawyer looks
    // for "Bluepages", not for "practitioner".
    const { page } = await open();

    const editions = await page
      .locator("select[aria-label='Bluebook edition'] option")
      .allTextContents();
    expect(editions).toEqual(["20th (2015)", "21st (2020)", "22nd (2025)"]);

    const ruleSets = await page
      .locator("select[aria-label^='Bluebook rule set'] option")
      .allTextContents();
    expect(ruleSets.join(" ")).toContain("Bluepages");
    expect(ruleSets.join(" ")).toContain("Whitepages");

    // And selecting one has to stick, or the choice is decorative.
    await page.selectOption("select[aria-label^='Bluebook rule set']", "academic");
    expect(
      await page.locator("select[aria-label^='Bluebook rule set']").inputValue(),
    ).toBe("academic");

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

  it("shows the commit it was built from, linked to the source", async () => {
    // On a site that deploys on every push, the version number alone does not
    // identify a build. The commit does, and a link makes it usable.
    const { page } = await open();
    const line = await waitForMatch(page, ".build-line", /commit/, 20_000);
    expect(line).toMatch(/[0-9a-f]{12}/);

    const href = await page.locator(".footer a.commit").first().getAttribute("href");
    expect(href).toMatch(/\/commit\/[0-9a-f]+$/);
    await page.close();
  }, 60_000);

  it("publishes the example filing for download", async () => {
    const { page } = await open();
    const response = await page.request.get(
      `${origin}${BASE_PATH}mata-v-avianca-filing.pdf`,
    );
    expect(response.status()).toBe(200);
    // A real PDF, not a 404 page with the right name.
    const body = await response.body();
    expect(body.subarray(0, 5).toString("latin1")).toBe("%PDF-");
    expect(body.length).toBeGreaterThan(100_000);
    await page.close();
  }, 60_000);

  it("publishes the walkthrough", async () => {
    const { page } = await open();
    const response = await page.request.get(`${origin}${BASE_PATH}tutorial.html`);
    expect(response.status()).toBe(200);
    const html = await response.text();
    // The lesson the page exists for.
    expect(html).toMatch(/does not report that these cases do not exist/i);
    expect(html).toContain("mata-v-avianca-filing.pdf");
    await page.close();
  }, 60_000);

  /** What each saved file must start with, so a mislabelled one is caught. */
  const SIGNATURES: ReadonlyArray<readonly [string, (bytes: Buffer) => void]> = [
    ["docx", (bytes) => expect(bytes.subarray(0, 2).toString("latin1")).toBe("PK")],
    ["pdf", (bytes) => expect(bytes.subarray(0, 5).toString("latin1")).toBe("%PDF-")],
    ["rtf", (bytes) => expect(bytes.subarray(0, 5).toString("latin1")).toBe("{\\rtf")],
    ["odt", (bytes) => expect(bytes.subarray(0, 2).toString("latin1")).toBe("PK")],
    [
      "report.json",
      (bytes) => {
        expect(JSON.parse(bytes.toString("utf8"))).toMatchObject({ tool: "ReCite" });
      },
    ],
  ];

  it.each(SIGNATURES.map(([format]) => format))(
    "saves the document as %s",
    async (format) => {
      const check = SIGNATURES.find(([id]) => id === format)![1];
      const { page } = await open();
      await page.fill("textarea", "Iqbal, 556 U.S. 662, 678 (2009).");

      await page.selectOption(".saveas select", format);
      const [download] = await Promise.all([
        page.waitForEvent("download", { timeout: 20_000 }),
        page.click(".saveas button"),
      ]);

      const stream = await download.createReadStream();
      const chunks: Buffer[] = [];
      for await (const chunk of stream) chunks.push(chunk as Buffer);
      const bytes = Buffer.concat(chunks);

      expect(bytes.length).toBeGreaterThan(50);
      check(bytes);

      // Written in the page: saving involves no network at all.
      expect(offOrigin()).toEqual([]);
      await page.close();
    },
    60_000,
  );

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

  it("reads a scanned page with the permissive engine, asking nobody for help", async () => {
    // The AGPL spike. `scribe.js-ocr` is AGPL-3.0 and is compiled into the
    // published bundle; `pdfjs-dist` + `tesseract.js` are Apache-2.0. This
    // asserts the candidate stack works end to end and stays on this origin —
    // tesseract.js defaults to jsDelivr for its worker, its WebAssembly core
    // *and* its language model, three separate ways to leak that someone is
    // OCRing a document.
    //
    // It deliberately does not assert anything comparative. Whether the
    // permissive stack is accurate *enough* is a measurement, not a boolean,
    // and it lives in `pnpm bench:ocr` where the answer is a recall figure.
    // See docs/testing.md for what that measurement currently says.
    const pdf = await makeScannedPdf(browser, [
      "Griggs v. State Farm Lloyds, 181 F.3d 694 (5th Cir. 1999).",
    ]);

    const { page } = await open("?engine=permissive");
    await page.setInputFiles("input[type=file]", {
      name: "scanned.pdf",
      mimeType: "application/pdf",
      buffer: pdf,
    });
    const text = await waitForMatch(page, "textarea", /Griggs/, 300_000);

    expect(text).toContain("181 F.3d 694");
    expect(offOrigin()).toEqual([]);
    await page.close();
  }, 300_000);
});

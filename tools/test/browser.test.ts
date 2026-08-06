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
 * - **Nothing leaves the origin.** `tesseract.js` defaults to jsDelivr for its
 *   worker, its WebAssembly core *and* its language model, and those strings
 *   are still in the bundle because they are the fallbacks. The only way to
 *   know the overrides took is to watch the network.
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

  it("offers a way to verify cases exist, and starts with it switched off", async () => {
    // The control that decides whether a fabrication can be caught at all.
    // Its default matters as much as its presence: `courtlistener` selected
    // by accident would be a connection nobody asked for.
    const { page } = await open();
    const picker = page.locator("select[aria-label^='Where to check']");

    expect(await picker.inputValue()).toBe("none");
    const options = await picker.locator("option").allTextContents();
    expect(options.join(" ")).toContain("CourtListener");

    // Choosing it changes nothing on the wire until a token is supplied.
    await picker.selectOption("courtlistener");
    await page.click("button:has-text('Check citations')").catch(() => undefined);
    expect(offOrigin()).toEqual([]);
    await page.close();
  }, 60_000);

  it("asks CourtListener nothing without a token", async () => {
    // The claim the whole feature rests on: the client refuses to exist
    // without a credential, so the untouched application is silent. Watched
    // rather than asserted about the source, because that is the only way to
    // know it is true of the built bundle.
    const { page } = await open();
    await page.fill("textarea", "Varghese, 925 F.3d 1339 (11th Cir. 2019).");
    await page.selectOption("select[aria-label^='Where to check']", "courtlistener");
    await page.click("button:has-text('Check citations')");
    await waitForMatch(page, ".status", /citation/i, 20_000);

    expect(offOrigin()).toEqual([]);
    await page.close();
  }, 60_000);

  it("opens a .txt file by drag-and-drop target", async () => {
    const { page } = await open();
    await page.setInputFiles("input[type=file]", {
      name: "brief.txt",
      mimeType: "text/plain",
      buffer: Buffer.from("Iqbal, 556 U.S. 662, 678 (2009). Id. at 680."),
    });
    // A supplied file lands in the editor, not in the text box.
    expect(await waitForMatch(page, ".page", /Iqbal/, 20_000)).toContain("Iqbal");
    expect(offOrigin()).toEqual([]);
    await page.close();
  }, 60_000);

  /** Open a `.txt` and wait for the editor to take over from the text box. */
  async function openDocument(page: Page, body: string): Promise<void> {
    await page.setInputFiles("input[type=file]", {
      name: "brief.txt",
      mimeType: "text/plain",
      buffer: Buffer.from(body),
    });
    await page.locator(".page").waitFor({ state: "visible", timeout: 20_000 });
  }

  it("turns a supplied file into a page, and leaves a paste in the text box", async () => {
    // The distinction the editor exists for. Somebody pasting a paragraph to
    // check one citation wants a text box; somebody who has just opened an
    // eleven-page filing wants to see the filing.
    const { page } = await open();
    expect(await page.locator("textarea").count()).toBe(1);
    expect(await page.locator(".page").count()).toBe(0);

    await openDocument(page, "Iqbal, 556 U.S. 662, 678 (2009). Id. at 680.");

    expect(await page.locator("textarea").count()).toBe(0);
    expect(await page.locator(".page").textContent()).toContain("556 U.S. 662");
    expect(await page.locator(".page").getAttribute("contenteditable")).toBe("true");
    expect(offOrigin()).toEqual([]);
    await page.close();
  }, 60_000);

  it("checks and fixes the document in the editor", async () => {
    // Everything above the surface is unchanged: `useReCite` still calls
    // read/apply/reveal and does not know which host it has.
    const { page } = await open();
    // `(U.S. 1999)` after a U.S. Reports citation is CT005, and its fix is
    // safe: the reporter already said which court it was.
    await openDocument(page, "Doe v. Roe, 526 U.S. 795 (U.S. 1999).");

    await page.click("button:has-text('Check citations')");
    await waitForMatch(page, ".status", /finding/i, 20_000);

    await page.click("button:has-text('Fix')");
    await waitForMatch(page, ".status", /Applied/i, 20_000);
    expect(await page.locator(".page").textContent()).toContain("526 U.S. 795 (1999)");
    await page.close();
  }, 60_000);

  it("marks findings in the text without putting anything in the document", async () => {
    // Painted through the CSS Custom Highlight API, so ReCite's own markup
    // never reaches the saved file and the caret does not move on a re-check.
    const { page } = await open();
    await openDocument(page, "Doe v. Roe, 526 U.S. 795 (U.S. 1999).");
    await page.click("button:has-text('Check citations')");
    await waitForMatch(page, ".status", /finding/i, 20_000);

    // A string rather than a function: evaluating a page-side callback would
    // need the DOM lib in this project, and a Node build tool could then
    // reference `document` and still typecheck.
    expect(await page.evaluate("CSS.highlights.size")).toBeGreaterThan(0);

    expect(await page.locator(".page").innerHTML()).not.toMatch(/recite-/);
    await page.close();
  }, 60_000);

  it("keeps formatting applied in the editor when the file is saved", async () => {
    const { page } = await open();
    await openDocument(page, "The pleading standard is set out in Iqbal.");

    // Double-click selects a word, which is the selection the toolbar acts on.
    await page.locator(".page p").first().dblclick();
    await page.click("button[aria-label^='Bold']");
    expect(await page.locator(".page strong").count()).toBeGreaterThan(0);

    // HTML rather than .docx because a ZIP's bytes are deflated, and the point
    // is the whole chain — DOM to model to writer.
    await page.selectOption(".saveas select", "html");
    const [download] = await Promise.all([
      page.waitForEvent("download", { timeout: 20_000 }),
      page.click(".saveas button"),
    ]);

    const stream = await download.createReadStream();
    const chunks: Buffer[] = [];
    for await (const chunk of stream) chunks.push(chunk as Buffer);
    expect(Buffer.concat(chunks).toString("utf8")).toContain("<strong>");

    expect(offOrigin()).toEqual([]);
    await page.close();
  }, 60_000);

  it("goes back to a text box on request, and forward again", async () => {
    // Neither surface is a trap.
    const { page } = await open();
    await openDocument(page, "Iqbal, 556 U.S. 662 (2009).");

    await page.locator("label:has-text('Edit as plain text') input").check();
    expect(await page.locator("textarea").inputValue()).toContain("556 U.S. 662");

    await page.locator("label:has-text('Edit as plain text') input").uncheck();
    expect(await page.locator(".page").textContent()).toContain("556 U.S. 662");
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
      ".page",
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

  it("reads a scanned statute without inventing a different one", async () => {
    // The section symbol is the one character Tesseract cannot be trusted
    // with here: on a dense page it reads `§§ 1544` as `§8§ 1544`, and the
    // parser then reports a citation to **section 8** — an authority the
    // document never cited. `import/ocr-repair.ts` puts it back. This is the
    // end-to-end proof that it does.
    const pdf = await makeScannedPdf(browser, [
      "Griggs v. State Farm Lloyds, 181 F.3d 694 (5th Cir. 1999).",
      "See also 18 U.S.C. §§ 1544, 1546 (2012).",
    ]);

    const { page } = await open();
    await page.setInputFiles("input[type=file]", {
      name: "scanned.pdf",
      mimeType: "application/pdf",
      buffer: pdf,
    });
    const text = await waitForMatch(page, ".page", /Griggs/, 300_000);

    expect(text).toContain("181 F.3d 694");
    // The repair fired, or did not need to. Either way no invented section.
    expect(text).not.toMatch(/§\d§/);
    expect(text).toContain("1544");
    // tesseract.js defaults to jsDelivr for its worker, its WebAssembly core
    // *and* its language model. All three are overridden to this origin.
    expect(offOrigin()).toEqual([]);
    await page.close();
  }, 300_000);
});

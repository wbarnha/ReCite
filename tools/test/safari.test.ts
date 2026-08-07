/**
 * The published site, in the Safari Apple actually ships.
 *
 * Every other browser suite here drives Playwright, and Playwright cannot
 * drive branded Safari — it relies on patches, so it bundles WebKit from
 * upstream `main` instead. That build runs real JavaScriptCore and is worth
 * having, but it runs *ahead* of the Safari on anyone's phone, so it is blind
 * to exactly the bugs people report: the ones shipping Safari still has and
 * trunk has already fixed.
 *
 * `/usr/bin/safaridriver` closes that gap. It is a W3C WebDriver server built
 * into macOS, WebDriver is plain HTTP and JSON, and GitHub's macOS images
 * already run `sudo safaridriver --enable` at build time — so reaching the real
 * browser costs one background process and no dependency at all.
 *
 * **What this proves, and what it does not.** Desktop Safari 26.x and Mobile
 * Safari on iOS 26.x are the same WebKit release train and the same
 * JavaScriptCore, so a *pure JavaScript* engine bug on an iPhone reproduces
 * here. It is still macOS: it cannot see the iOS file picker, touch-only
 * interaction, or the memory ceiling that kills the content process on a real
 * handset — which for an app loading `pdfjs-dist` and `tesseract.js` is a live
 * risk. It also only ever tests the Safari on the runner, so an older iPhone
 * stays out of reach.
 *
 * ```console
 * $ safaridriver --port 4444 &
 * $ RECITE_WEBDRIVER=http://127.0.0.1:4444 pnpm test:safari
 * ```
 */

import { existsSync, readdirSync } from "node:fs";
import { type Server } from "node:http";

import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { BASE_PATH, DIST, serveSite, siteIsBuilt } from "./helpers/site-server.js";
import { join } from "node:path";

import { reachable, waitForElement, WebDriverSession } from "./helpers/webdriver.js";

/**
 * Opt in explicitly.
 *
 * Driving Safari needs remote automation enabled on the machine, which is a
 * change to someone's browser and not something a test run should assume. CI
 * sets this; a contributor sets it when they mean to.
 */
const endpoint = process.env["RECITE_WEBDRIVER"];

/**
 * In CI a missing Safari is a failure, not a skip — same rule as the platform
 * matrix. A job whose whole purpose is to run the real browser has done nothing
 * of value if it quietly ran nothing.
 */
const REQUIRED = process.env["RECITE_REQUIRE_SAFARI"] === "1";

/**
 * The lazily-imported chunk that holds `pdfjs-dist` and `tesseract.js`.
 *
 * Found by name rather than pinned, since the hash changes every build.
 */
const engineChunk = (() => {
  const assets = join(DIST, "assets");
  if (!existsSync(assets)) return "";
  const found = readdirSync(assets).find(
    (name) => name.startsWith("pdf-permissive-") && name.endsWith(".js"),
  );
  return found ? `assets/${found}` : "";
})();

const possible =
  siteIsBuilt() &&
  endpoint !== undefined &&
  (REQUIRED || (process.platform === "darwin" && existsSync("/usr/bin/safaridriver")));

describe.skipIf(!possible)("the published site in the Safari Apple ships", () => {
  let server: Server;
  let origin: string;
  let session: WebDriverSession;

  beforeAll(async () => {
    if (!(await reachable(endpoint!))) {
      throw new Error(
        `No WebDriver server at ${endpoint}. Start one with ` +
          `\`safaridriver --port 4444 &\`, and note that remote automation must ` +
          `be enabled (\`sudo safaridriver --enable\`).`,
      );
    }

    ({ server, origin } = await serveSite({ collectErrors: true }));
    session = await WebDriverSession.open(endpoint!, "safari");

    // Printed so a green run always says which browser was green. A matrix
    // that claims Safari is worth nothing if nobody can see the version.
    console.log(`  driving ${session.describe()}`);
  }, 180_000);

  afterAll(async () => {
    await session?.close();
    server?.close();
  });

  /** Load the app fresh, with the error collector already listening. */
  async function open(): Promise<void> {
    await session.navigate(`${origin}${BASE_PATH}`);
    await waitForPage(
      "return document.querySelector('h1') ? document.querySelector('h1').textContent : ''",
      (text) => text === "ReCite",
      60_000,
      "the app to render",
    );
  }

  /**
   * Everything that went wrong, from all three places it can show up.
   *
   * The first version of this read only `window.__reciteErrors`, and reported
   * "none recorded" for two solid failures. Two reasons, both worth stating:
   *
   * - `window.__reciteErrors || []` cannot tell "nothing was thrown" from
   *   "the collector never loaded". It now reports the collector's absence as
   *   a fault of its own, because a silent instrument is worse than none.
   * - **ReCite catches import failures.** `FileDrop` puts the message in
   *   `.filedrop-error` rather than letting it reach `window.onerror`, so the
   *   thing being hunted was on screen the whole time and the suite was
   *   looking past it.
   */
  async function faults(): Promise<string[]> {
    const state = JSON.parse(
      await session.execute<string>(`return JSON.stringify({
        collector: typeof window.__reciteErrors !== 'undefined',
        thrown: window.__reciteErrors || [],
        importError: (document.querySelector('.filedrop-error') || {}).textContent || '',
        progress: (document.querySelector('.filedrop-progress') || {}).textContent || '',
        status: (document.querySelector('.status') || {}).textContent || ''
      })`),
    ) as {
      collector: boolean;
      thrown: string[];
      importError: string;
      progress: string;
      status: string;
    };

    const found: string[] = [];
    if (!state.collector) {
      found.push(
        "the error collector never loaded — this suite is blind, fix that first",
      );
    }
    found.push(...state.thrown);
    if (state.importError.trim())
      found.push(`the app reported: ${state.importError.trim()}`);
    return found;
  }

  /** What the page is showing, for a failure message that can be acted on. */
  async function narrate(): Promise<string> {
    const state = JSON.parse(
      await session.execute<string>(`return JSON.stringify({
        progress: (document.querySelector('.filedrop-progress') || {}).textContent || '',
        status: (document.querySelector('.status') || {}).textContent || '',
        importError: (document.querySelector('.filedrop-error') || {}).textContent || ''
      })`),
    ) as { progress: string; status: string; importError: string };
    return (
      `progress=${JSON.stringify(state.progress.trim())} ` +
      `status=${JSON.stringify(state.status.trim())} ` +
      `error=${JSON.stringify(state.importError.trim())}`
    );
  }

  /**
   * Put a file on the file input, from inside the page.
   *
   * W3C attaches a file by sending a path to the input, which is the faithful
   * route and is not available here: the input is deliberately hidden — a
   * visually-hidden control behind a styled label, which is how the drop zone
   * is built — and a remote may decline to type into something it cannot see.
   *
   * So the `File` is constructed in the page and assigned through a
   * `DataTransfer`, then `change` is dispatched. That is the same object and
   * the same event the browser produces when someone picks a file, so
   * `FileDrop`'s handler and everything under it run exactly as they would;
   * only the native picker, which no driver can automate anyway, is skipped.
   * Verified against Chromium before being relied on here.
   */
  async function openFile(name: string, contents: Buffer | string): Promise<void> {
    const base64 = Buffer.from(contents).toString("base64");
    const attached = await session.execute<string>(
      `var input = document.querySelector('input[type=file]');
       if (!input) return 'no file input on the page';
       var raw = atob(${JSON.stringify(base64)});
       var bytes = new Uint8Array(raw.length);
       for (var i = 0; i < raw.length; i++) bytes[i] = raw.charCodeAt(i);
       var transfer = new DataTransfer();
       transfer.items.add(new File([bytes], ${JSON.stringify(name)}));
       input.files = transfer.files;
       input.dispatchEvent(new Event('change', { bubbles: true }));
       return 'ok';`,
    );
    expect(attached, `could not attach ${name}`).toBe("ok");
  }

  /**
   * Wait for the page, and say what it threw if the wait never finishes.
   *
   * The collector exists so a failure can name the exception, and the first
   * version of this file wasted that: it read the errors only *after* a
   * successful wait, so the one run that mattered — a four-minute timeout on
   * the PDF — reported `Last value: ""` and threw the actual message away.
   *
   * Now the errors are read on every poll. A throw ends the wait immediately
   * with the browser's own words, and a genuine timeout still reports whatever
   * was recorded.
   */
  async function waitForPage(
    script: string,
    matches: (text: string) => boolean,
    timeoutMs: number,
    what: string,
  ): Promise<string> {
    const deadline = Date.now() + timeoutMs;
    let last = "";

    while (Date.now() < deadline) {
      const wrong = await faults().catch(() => []);
      if (wrong.length > 0) {
        throw new Error(`${what}: ${wrong.join("; ")}`);
      }
      last = await session.execute<string>(script);
      if (matches(last)) return last;
      await new Promise((resolve) => setTimeout(resolve, 250));
    }

    const wrong = await faults().catch(() => []);
    throw new Error(
      `${what} did not happen within ${timeoutMs}ms. ` +
        `Last value: ${JSON.stringify(last).slice(0, 200)}. ` +
        `Faults: ${wrong.length > 0 ? wrong.join("; ") : "none recorded"}. ` +
        `Page was showing ${await narrate().catch(() => "nothing readable")}`,
    );
  }

  it("loads and runs without a script error", async () => {
    await open();
    expect(await faults()).toEqual([]);
  }, 120_000);

  it("checks a citation", async () => {
    await open();
    const textarea = await waitForElement(session, "textarea");
    await session.sendKeys(
      textarea,
      "Doe v. Roe, 526 U.S. 795 (U.S. 1999); Miller, 174 F.3d 366, 371 (2d Cir. 1999).",
    );

    // Found by text rather than by position: the toolbar's order is not what
    // this test is about.
    const check = await session.execute<boolean>(
      "var b = Array.prototype.find.call(document.querySelectorAll('button')," +
        " function (x) { return /Check citations/.test(x.textContent); });" +
        " if (b) { b.click(); return true; } return false;",
    );
    expect(check, "the Check citations button is missing").toBe(true);

    await waitForPage(
      "return document.querySelector('.status') ? document.querySelector('.status').textContent : ''",
      (text) => /citation/i.test(text),
      60_000,
      "the check to report",
    );
    expect(await faults()).toEqual([]);
  }, 120_000);

  it("opens a file into the editor", async () => {
    await open();
    await openFile("brief.txt", "Iqbal, 556 U.S. 662, 678 (2009). Id. at 680.");

    await waitForPage(
      "return document.querySelector('.page') ? document.querySelector('.page').textContent : ''",
      (text) => text.includes("556 U.S. 662"),
      60_000,
      "the document to open",
    );
    expect(await faults()).toEqual([]);
  }, 120_000);

  it("reports whether this browser can iterate a ReadableStream", async () => {
    // Evidence, and the diagnosis in one line.
    //
    // `pdfjs-dist` reads a page's text layer with
    // `for await (const chunk of this.streamTextContent(...))`. Async iteration
    // of a `ReadableStream` is part of the Streams standard and Safari has not
    // shipped it, so asking for the iterator gets `undefined` and calling it
    // throws `undefined is not a function (near '...e of t...')` — which is
    // exactly, character for character, what an iPhone reported.
    //
    // Not an assertion about the browser: `stream-async-iterator.ts` installs
    // the missing iterator, so by the time a PDF is opened it is there either
    // way. This records which of the two happened, so a future reader can see
    // whether Safari has caught up and the polyfill can go.
    await open();
    const native = await session.execute<string>(
      `return JSON.stringify({
         native: typeof ReadableStream.prototype[Symbol.asyncIterator],
         afterPolyfill: null
       })`,
    );
    console.log(`  ReadableStream async iteration, natively: ${native}`);
    expect(native).toContain("native");
  }, 120_000);

  it("loads the PDF engine chunk at all", async () => {
    // Narrowing, not coverage.
    //
    // Both PDF cases fail in about two seconds — the same for a text-layer PDF
    // as for an eleven-page scan — which is far too fast to be PDF *work*. The
    // PDF path is also the only one that takes a dynamic `import()`, and a
    // `.txt` (which takes none) opens fine. That points at the chunk failing
    // when it is evaluated rather than at anything it later does.
    //
    // So import the chunk directly and report what comes back. The app catches
    // import failures and shows only `.message`, which is how this hunt lost
    // the stack; here nothing catches it, so the frame survives.
    await open();

    const outcome = await session.execute<string>(
      `return import(${JSON.stringify(`${BASE_PATH}${engineChunk}`)})
         .then(function () { return 'ok'; },
               function (e) { return 'THREW: ' + (e && (e.stack || e.message) || String(e)); });`,
    );

    expect(
      outcome,
      `the lazily-imported PDF chunk (${engineChunk}) failed to evaluate`,
    ).toBe("ok");
  }, 180_000);

  it("opens a PDF", async () => {
    // The path an iPhone crashed on, in the engine family that crashed. This
    // is the single test the whole file exists for: a text-layer PDF, so the
    // dynamic import of `pdfjs-dist` happens and OCR does not.
    await open();
    await openFile("brief.pdf", textLayerPdf("Miller, 174 F.3d 366 (2d Cir. 1999)."));

    await waitForPage(
      "return document.querySelector('.page') ? document.querySelector('.page').textContent : ''",
      (text) => /174 F\.?\s?3d 366/.test(text),
      120_000,
      "the PDF to be read",
    );
    expect(await faults(), "the PDF path failed in the browser Apple ships").toEqual(
      [],
    );
  }, 300_000);

  it("opens the example filing", async () => {
    // The case a user actually reported: on iOS 26.5.4, pressing **Try the
    // example filing** answers `undefined is not a function (near '...e of
    // t...')` — JavaScriptCore's wording for iterating something with no
    // iterator.
    //
    // Everything above this opens a PDF with a text layer, which never reaches
    // the recognition engine. The example filing is eleven pages, part typed
    // and part scanned exhibit, so it is the only fixture that runs
    // `tesseract.js` — and the report says that is where the difference is.
    // It is also reached by its own button rather than the file input, so this
    // covers `loadExample` too.
    //
    // Slow on purpose. Recognising eleven pages is the point; a fast version
    // of this test would be a version that does not run OCR, which is the
    // thing under suspicion.
    await open();

    const pressed = await session.execute<boolean>(
      "var b = Array.prototype.find.call(document.querySelectorAll('button')," +
        " function (x) { return /Try the example filing/.test(x.textContent); });" +
        " if (b) { b.click(); return true; } return false;",
    );
    expect(pressed, "the example filing button is missing").toBe(true);

    // Errors are checked *while* it works, not only at the end: if the engine
    // throws, the editor never fills and a plain wait would time out after ten
    // minutes reporting nothing useful.
    // Matched on the docket header, which comes off the text layer, rather
    // than on a citation out of the scanned exhibit.
    //
    // That is a deliberate limit and worth stating. What this test exists to
    // prove is the reported failure: pressing the button used to answer
    // `undefined is not a function` and read nothing at all. Text on the page
    // proves `loadExample`, pdf.js and the stream iterator all work in Safari.
    //
    // What it does not prove is recognition finishing. Eleven pages of OCR ran
    // past ten minutes on this runner while reading correctly the whole time —
    // a wall-clock cost, not a fault, and not one worth paying on a machine
    // that bills at ten times the rate. The OCR path is covered end to end on
    // Chromium in `browser.test.ts`, which is where minutes are cheap.
    await waitForPage(
      "return document.querySelector('.page') ? document.querySelector('.page').textContent : ''",
      (text) => /1:22-cv-01461/.test(text),
      240_000,
      "the example filing to be read",
    );

    expect(await faults(), "the example filing failed in Safari").toEqual([]);
  }, 300_000);
});

/**
 * The smallest PDF with a real text layer.
 *
 * Kept identical in shape to the one in `platforms.test.ts` so the two suites
 * exercise the same path; written by hand so neither depends on the OCR engine.
 */
function textLayerPdf(line: string): Buffer {
  const escaped = line.replace(/([\\()])/g, "\\$1");
  const stream = `BT /F1 12 Tf 40 700 Td (${escaped}) Tj ET`;

  const objects = [
    "<< /Type /Catalog /Pages 2 0 R >>",
    "<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
    "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] " +
      "/Resources << /Font << /F1 5 0 R >> >> /Contents 4 0 R >>",
    `<< /Length ${stream.length} >>\nstream\n${stream}\nendstream`,
    "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>",
  ];

  let pdf = "%PDF-1.4\n";
  const offsets: number[] = [];
  for (const [index, body] of objects.entries()) {
    offsets.push(pdf.length);
    pdf += `${index + 1} 0 obj\n${body}\nendobj\n`;
  }

  const xref = pdf.length;
  pdf += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  for (const offset of offsets) {
    pdf += `${String(offset).padStart(10, "0")} 00000 n \n`;
  }
  pdf +=
    `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\n` +
    `startxref\n${xref}\n%%EOF\n`;

  return Buffer.from(pdf, "latin1");
}

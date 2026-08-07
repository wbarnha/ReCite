/**
 * The published site, on every platform it claims to work on.
 *
 * `browser.test.ts` is the deep suite: OCR, downloads, the network promise, the
 * editor. It runs on one engine, because running OCR five times would cost
 * twenty minutes to learn one thing.
 *
 * This is the wide one. It asks a small number of questions on **every** engine
 * and form factor, because the failures it exists to catch are the ones that
 * are invisible on the engine you happened to develop against. The case that
 * motivated it: an iPhone user hit `undefined is not a function` opening a PDF —
 * JavaScriptCore's message for iterating something with no iterator — while
 * Chromium CI was green.
 *
 * The bar for adding a test here is that it must be cheap and it must be about
 * something an engine can differ on. Anything slow, or anything about a rule,
 * belongs in the suites that already cover it.
 */

import { type Server } from "node:http";

import type * as playwrightTypes from "playwright";
import type { Browser, Page } from "playwright";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import type { EngineName } from "./helpers/platforms.js";
import {
  contextFor,
  executableFor,
  launchPlatform,
  selectedPlatforms,
} from "./helpers/platforms.js";
import { BASE_PATH, serveSite, siteIsBuilt } from "./helpers/site-server.js";

/** Imported dynamically so the suite still loads where Playwright is absent. */
let playwright: typeof playwrightTypes | undefined;
try {
  playwright = await import("playwright");
} catch {
  playwright = undefined;
}

/**
 * Wait for an element's text to match.
 *
 * The suites here drive Playwright from vitest, whose `expect` has none of
 * Playwright's web-first assertions — so waiting is explicit, the same way
 * `browser.test.ts` does it. Polled through the typed locator API rather than
 * by evaluating a callback in the page, because a page-side version would need
 * the DOM lib in this project.
 */
async function waitForText(
  page: Page,
  selector: string,
  pattern: RegExp,
  timeout: number,
): Promise<string> {
  const locator = page.locator(selector).first();
  const deadline = Date.now() + timeout;
  let last = "";

  while (Date.now() < deadline) {
    last = (await locator.textContent().catch(() => null)) ?? "";
    if (pattern.test(last)) return last;
    await new Promise((resolve) => setTimeout(resolve, 250));
  }

  throw new Error(
    `${selector} never matched ${String(pattern)} within ${timeout}ms. ` +
      `Last value: ${JSON.stringify(last.slice(0, 200))}`,
  );
}

const built = siteIsBuilt();
const platforms = playwright ? selectedPlatforms() : [];

/**
 * Which engines are actually on this machine.
 *
 * Resolved at collection time so a missing engine can *skip* its block rather
 * than run it and quietly pass. That distinction is the whole point of this
 * file: a suite which reports green for an engine it never launched is worse
 * than no suite, because it is a claim that iOS works made by a machine that
 * has never run WebKit.
 */
const installed = new Map<EngineName, boolean>(
  (["chromium", "firefox", "webkit"] as const).map((engine) => [
    engine,
    playwright !== undefined && executableFor(playwright, engine) !== undefined,
  ]),
);

/**
 * In CI a missing engine is a failure, not a skip.
 *
 * Locally a contributor with only Chromium should still get a useful run. On
 * the matrix, every job exists precisely to run one engine, so an engine that
 * failed to install must turn the job red instead of reporting a green tick
 * for a platform nobody tested.
 */
const REQUIRED = process.env["RECITE_REQUIRE_PLATFORMS"] === "1";

describe.skipIf(!built || !playwright)("the published site, per platform", () => {
  let server: Server;
  let origin: string;

  beforeAll(async () => {
    ({ server, origin } = await serveSite());
  }, 120_000);

  afterAll(() => {
    server?.close();
  });

  for (const platform of platforms) {
    const present = installed.get(platform.engine) === true;

    // A matrix names its cases at run time; that is what makes a failure say
    // "iOS · Safari" instead of a line number.
    // eslint-disable-next-line vitest/valid-title
    describe.skipIf(!present && !REQUIRED)(platform.label, () => {
      let browser: Browser | undefined;

      beforeAll(async () => {
        browser = await launchPlatform(playwright!, platform);
        if (!browser) {
          throw new Error(
            `${platform.id}: ${platform.engine} is not installed, so nothing about ` +
              `${platform.label} was tested. Install it with ` +
              `\`pnpm exec playwright install ${platform.engine}\`.`,
          );
        }
      }, 180_000);

      afterAll(async () => {
        await browser?.close();
      });

      /**
       * Open the app, collecting everything that went wrong on the way.
       *
       * Page errors are the whole point of this file, so they are captured
       * from before navigation rather than asked for afterwards.
       */
      async function open(): Promise<{
        page: Page;
        errors: string[];
        console: string[];
      }> {
        const context = await browser!.newContext(contextFor(playwright!, platform));
        const page = await context.newPage();
        const errors: string[] = [];
        const consoleErrors: string[] = [];
        page.on("pageerror", (error) => errors.push(error.message));
        page.on("console", (message) => {
          if (message.type() === "error") consoleErrors.push(message.text());
        });
        await page.goto(`${origin}${BASE_PATH}`, { waitUntil: "load" });
        return { page, errors, console: consoleErrors };
      }

      it("loads and runs without a script error", async () => {
        const { page, errors, console: consoleErrors } = await open();
        expect(await waitForText(page, "h1", /^ReCite$/, 30_000)).toBe("ReCite");
        expect(errors, `${platform.id}: uncaught script errors`).toEqual([]);
        expect(consoleErrors, `${platform.id}: console errors`).toEqual([]);
        await page.close();
      }, 120_000);

      it("checks a citation", async () => {
        // The engine actually running the rule set, end to end. A parser built
        // out of regular expressions is exactly the kind of code that differs
        // between engines without anyone noticing.
        const { page, errors } = await open();
        await page.fill(
          "textarea",
          "Doe v. Roe, 526 U.S. 795 (U.S. 1999); Miller, 174 F.3d 366, 371 (2d Cir. 1999).",
        );
        await page.click("button:has-text('Check citations')");
        await waitForText(page, ".status", /citation/i, 60_000);
        await page
          .locator(".finding")
          .first()
          .waitFor({ state: "visible", timeout: 30_000 });
        expect(errors, `${platform.id}: uncaught script errors`).toEqual([]);
        await page.close();
      }, 120_000);

      it("opens a file into the editor", async () => {
        // Reading a file exercises `File.arrayBuffer`, `TextDecoder` and the
        // format sniffing, then hands off to the `contenteditable` surface.
        const { page, errors } = await open();
        await page.setInputFiles("input[type=file]", {
          name: "brief.txt",
          mimeType: "text/plain",
          buffer: Buffer.from("Iqbal, 556 U.S. 662, 678 (2009). Id. at 680."),
        });
        await waitForText(page, ".page", /556 U\.S\. 662/, 60_000);
        expect(errors, `${platform.id}: uncaught script errors`).toEqual([]);
        await page.close();
      }, 120_000);

      it("opens a PDF", async () => {
        // The path that broke on an iPhone while Chromium stayed green. It is
        // the only path that takes a dynamic `import()`, and the chunk it pulls
        // in — `pdfjs-dist` and `tesseract.js` — is the most modern JavaScript
        // the app ships. A text-layer PDF, so no OCR and no minutes of work.
        const { page, errors } = await open();
        await page.setInputFiles("input[type=file]", {
          name: "brief.pdf",
          mimeType: "application/pdf",
          buffer: textLayerPdf(
            "Miller v. United Airlines, Inc., 174 F.3d 366 (2d Cir. 1999).",
          ),
        });
        await waitForText(page, ".page", /174 F\.?\s?3d 366/, 180_000);
        expect(errors, `${platform.id}: uncaught script errors`).toEqual([]);
        await page.close();
      }, 240_000);

      it("saves the document", async () => {
        // Writing a file in the page uses `Blob`, an object URL and a
        // programmatic download — three things engines disagree about, and the
        // last step of the only workflow that matters.
        const { page, errors } = await open();
        await page.fill("textarea", "Iqbal, 556 U.S. 662, 678 (2009).");
        await page.selectOption(".saveas select", "txt");
        const [download] = await Promise.all([
          page.waitForEvent("download", { timeout: 60_000 }),
          page.click(".saveas button"),
        ]);
        expect(await download.failure()).toBeNull();
        expect(errors, `${platform.id}: uncaught script errors`).toEqual([]);
        await page.close();
      }, 120_000);

      it("fits its viewport without scrolling sideways", async () => {
        // The one layout question worth asking on a phone. A document editor
        // that overflows horizontally on a 393px screen is unusable, and the
        // desktop widths are covered in detail by `browser.test.ts`.
        const { page } = await open();
        await page.setInputFiles("input[type=file]", {
          name: "brief.txt",
          mimeType: "text/plain",
          buffer: Buffer.from("Iqbal, 556 U.S. 662, 678 (2009). Id. at 680."),
        });
        await page.locator(".page").waitFor({ state: "visible", timeout: 60_000 });
        const overflow = await page.evaluate<number>(
          "document.documentElement.scrollWidth - document.documentElement.clientWidth",
        );
        expect(
          overflow,
          `${platform.id}: the page scrolls sideways`,
        ).toBeLessThanOrEqual(1);
        await page.close();
      }, 120_000);

      it("reports the engine it actually ran on", async () => {
        // Not an assertion so much as evidence. A matrix that claims to cover
        // iOS is worth nothing if every job quietly ran the same engine, and
        // this puts the user agent in the log where a reader can check.
        const { page } = await open();
        const agent = await page.evaluate<string>("navigator.userAgent");
        console.log(`  ${platform.id} → ${agent}`);
        expect(agent).toBeTruthy();
        await page.close();
      }, 120_000);
    });
  }
});

/**
 * The smallest PDF with a real text layer.
 *
 * Written by hand rather than fetched or generated, because this file must not
 * depend on the OCR engine: the point is to exercise the PDF **text** path on
 * every engine in seconds. `tools/test/helpers/scanned-pdf.ts` covers the other
 * kind, once, on one engine.
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

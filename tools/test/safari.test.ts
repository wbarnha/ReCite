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

import { existsSync, mkdtempSync, writeFileSync } from "node:fs";
import { type Server } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { BASE_PATH, serveSite, siteIsBuilt } from "./helpers/site-server.js";
import { reachable, waitFor, WebDriverSession } from "./helpers/webdriver.js";

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

const possible =
  siteIsBuilt() &&
  endpoint !== undefined &&
  (REQUIRED || (process.platform === "darwin" && existsSync("/usr/bin/safaridriver")));

describe.skipIf(!possible)("the published site in the Safari Apple ships", () => {
  let server: Server;
  let origin: string;
  let session: WebDriverSession;
  /** Where fixtures are written, since a file input takes a path over WebDriver. */
  let fixtures: string;

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
    fixtures = mkdtempSync(join(tmpdir(), "recite-safari-"));

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
    await waitFor<string>(
      session,
      "return document.querySelector('h1') ? document.querySelector('h1').textContent : ''",
      (text) => text === "ReCite",
      60_000,
      "the app to render",
    );
  }

  /** Everything the page threw since it loaded. */
  async function errors(): Promise<string[]> {
    return session.execute<string[]>("return window.__reciteErrors || []");
  }

  /** Write a fixture and hand its path to the file input, as W3C prescribes. */
  async function openFile(name: string, contents: Buffer | string): Promise<void> {
    const path = join(fixtures, name);
    writeFileSync(path, contents);
    const input = await session.find("input[type=file]");
    expect(input, "the file input is missing").toBeDefined();
    await session.sendKeys(input!, path);
  }

  it("loads and runs without a script error", async () => {
    await open();
    expect(await errors()).toEqual([]);
  }, 120_000);

  it("checks a citation", async () => {
    await open();
    const textarea = await session.find("textarea");
    expect(textarea).toBeDefined();
    await session.sendKeys(
      textarea!,
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

    await waitFor<string>(
      session,
      "return document.querySelector('.status') ? document.querySelector('.status').textContent : ''",
      (text) => /citation/i.test(text),
      60_000,
      "the check to report",
    );
    expect(await errors()).toEqual([]);
  }, 120_000);

  it("opens a file into the editor", async () => {
    await open();
    await openFile("brief.txt", "Iqbal, 556 U.S. 662, 678 (2009). Id. at 680.");

    await waitFor<string>(
      session,
      "return document.querySelector('.page') ? document.querySelector('.page').textContent : ''",
      (text) => text.includes("556 U.S. 662"),
      60_000,
      "the document to open",
    );
    expect(await errors()).toEqual([]);
  }, 120_000);

  it("opens a PDF", async () => {
    // The path an iPhone crashed on, in the engine family that crashed. This
    // is the single test the whole file exists for: a text-layer PDF, so the
    // dynamic import of `pdfjs-dist` happens and OCR does not.
    await open();
    await openFile("brief.pdf", textLayerPdf("Miller, 174 F.3d 366 (2d Cir. 1999)."));

    await waitFor<string>(
      session,
      "return document.querySelector('.page') ? document.querySelector('.page').textContent : ''",
      (text) => /174 F\.?\s?3d 366/.test(text),
      240_000,
      "the PDF to be read",
    );
    expect(await errors(), "the PDF path threw in the browser Apple ships").toEqual([]);
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

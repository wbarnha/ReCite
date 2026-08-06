/**
 * How long opening a document takes, and how much of it survives.
 *
 * Run against the built site in a real browser, because that is the only place
 * the OCR engine exists — a Node benchmark of this code path would be
 * measuring something nobody uses.
 *
 * ```console
 * $ pnpm build:release
 * $ pnpm bench:ocr
 * ```
 *
 * ## Why it drives the UI rather than calling the reader
 *
 * There is no test hook on `window`. The benchmark sets a file on the file
 * input and waits for the editor to fill, exactly as a user would, and times
 * that from outside the page. Two reasons. It keeps a benchmarking affordance
 * out of the shipped bundle, where it would be one more thing to audit. And
 * the number it produces is the one the user actually experiences, including
 * the parts — React rendering, the editor updating — that an internal timer
 * would leave out.
 *
 * The phase breakdown from `import/metrics.ts` is scraped from the DOM
 * alongside it, so the harness gets the inside view as well without depending
 * on it.
 *
 * ## What it refuses to conclude
 *
 * Elapsed time on its own cannot approve a change. `tools/tessdata` documents
 * choosing an 11 MB language model over a 2.9 MB one because "a misread digit
 * in a volume number is a wrong citation that looks right", and every knob in
 * this area trades the same way. So each run is scored for citation recall
 * against known-good text, and a configuration that is faster and loses
 * citations is reported as a regression, not an improvement.
 */

import type { Server } from "node:http";

import type { Browser } from "playwright";

import { citationAccuracy, similarity } from "./accuracy.js";
import { makeScannedPdf } from "../test/helpers/scanned-pdf.js";
import {
  BASE_PATH,
  CHROMIUM,
  serveSite,
  siteIsBuilt,
} from "../test/helpers/site-server.js";

/** The document each run is scored against. */
const SCANNED_LINES = [
  "Miller v. United Airlines, Inc., 174 F.3d 366, 371-72 (2d Cir. 1999).",
  "See also Iqbal, 556 U.S. 662, 678 (2009).",
  "Zicherman v. Korean Air Lines Co., 516 U.S. 217 (1996).",
  "Griggs v. State Farm Lloyds, 181 F.3d 694 (5th Cir. 1999).",
  "18 U.S.C. §§ 1544, 1546 (2012).",
];

/** OCR modes worth timing. `never` is the floor: no recognition at all. */
const MODES = ["auto", "always", "never"] as const;

/**
 * Worker counts to sweep, under the default mode.
 *
 * `null` leaves it to tesseract.js. The reason to want
 * fewer is not throughput: it is that recognition saturating every core makes
 * the rest of the browser stutter, and a task pane that freezes Word looks
 * like a crash. This sweep is what says how much that costs.
 */
const WORKER_COUNTS: ReadonlyArray<number | null> = [null, 1, 2, 4];

interface Run {
  readonly label: string;
  /** Requests that left the origin. Must always be empty. */
  readonly offOrigin: readonly string[];
  readonly ms: number;
  readonly chars: number;
  readonly similarity: number;
  readonly recall: number;
  readonly lost: readonly string[];
  readonly phases: string;
}

async function main(): Promise<void> {
  if (!siteIsBuilt()) {
    console.error(
      "No build to measure. Run `pnpm build:release` first (and note this " +
        "needs the pre-installed Chromium at " +
        CHROMIUM +
        ").",
    );
    process.exitCode = 1;
    return;
  }

  const playwright = await import("playwright");
  const { server, origin } = await serveSite();
  const browser = await playwright.chromium.launch({
    executablePath: CHROMIUM,
    args: ["--no-sandbox"],
  });

  try {
    const expected = SCANNED_LINES.join("\n");
    const pdf = await makeScannedPdf(browser, SCANNED_LINES);
    console.log(
      `Fixture: a ${Math.round(pdf.length / 1024)} KB scanned PDF with no text ` +
        `layer, holding ${SCANNED_LINES.length} lines.\n`,
    );

    const runs: Run[] = [];

    for (const mode of MODES) {
      runs.push(await time(browser, origin, pdf, expected, { mode }));
    }
    // The same file again under the default mode: this is the cache path, and
    // it should be indistinguishable from instant.
    runs.push(
      await time(browser, origin, pdf, expected, { mode: "auto", twice: true }),
    );

    for (const workers of WORKER_COUNTS) {
      if (workers === null) continue; // already measured as plain `auto`
      runs.push(await time(browser, origin, pdf, expected, { mode: "auto", workers }));
    }

    report(runs);
  } finally {
    await browser.close();
    close(server);
  }
}

async function time(
  browser: Browser,
  origin: string,
  pdf: Buffer,
  expected: string,
  options: {
    mode: (typeof MODES)[number];
    workers?: number;
    twice?: boolean;
  },
): Promise<Run> {
  const { mode, workers, twice = false } = options;
  const page = await browser.newPage();

  // Every request, so a stack that quietly reaches for a CDN is caught here
  // rather than in production. tesseract.js defaults to jsDelivr for three
  // separate assets.
  const offOrigin: string[] = [];
  page.on("request", (request) => {
    const url = request.url();
    if (
      !url.startsWith(origin) &&
      !url.startsWith("data:") &&
      !url.startsWith("blob:")
    ) {
      offOrigin.push(url);
    }
  });

  // Both knobs are query parameters rather than controls — see
  // `import/ocr-options.ts` and `import/engine.ts` for why they are reachable
  // but not on the toolbar.
  const parameters = new URLSearchParams();
  if (workers !== undefined) parameters.set("workers", String(workers));
  const query = parameters.size > 0 ? `?${parameters.toString()}` : "";
  await page.goto(`${origin}${BASE_PATH}${query}`, { waitUntil: "networkidle" });
  await page.selectOption("select[aria-label^='When to read text']", mode);

  const open = async () => {
    await page.setInputFiles("input[type=file]", {
      name: "scanned.pdf",
      mimeType: "application/pdf",
      buffer: pdf,
    });
    await page.locator(".import-notice").first().waitFor({ timeout: 300_000 });
  };

  if (twice) {
    await open();
    // Clear the editor so the second open is observable.
    await page.fill("textarea", "");
  }

  const started = performance.now();
  await open();
  const ms = Math.round(performance.now() - started);

  const text = await page.locator("textarea").first().inputValue();
  // The element also holds the "Forget opened documents" button; only the
  // timing sentence is wanted here.
  const phases = (
    (await page
      .locator(".import-timing")
      .first()
      .textContent()
      .catch(() => null)) ?? ""
  ).replace(/\s*Forget opened documents\s*$/, "");

  await page.close();

  const accuracy = citationAccuracy(expected, text);
  const label = twice
    ? `${mode} (second open)`
    : workers === undefined
      ? mode
      : `${mode}, ${workers} worker${workers === 1 ? "" : "s"}`;

  return {
    label,
    offOrigin: [...new Set(offOrigin)],
    ms,
    chars: text.length,
    similarity: similarity(expected, text),
    recall: accuracy.recall,
    lost: accuracy.lost,
    phases: phases.trim(),
  };
}

function report(runs: readonly Run[]): void {
  const pad = (text: string, width: number) => text.padEnd(width);
  console.log(
    pad("mode", 22) +
      pad("elapsed", 10) +
      pad("chars", 8) +
      pad("similarity", 12) +
      "citation recall",
  );
  console.log("-".repeat(72));

  for (const run of runs) {
    console.log(
      pad(run.label, 22) +
        pad(`${(run.ms / 1000).toFixed(1)}s`, 10) +
        pad(String(run.chars), 8) +
        pad(`${(run.similarity * 100).toFixed(1)}%`, 12) +
        `${(run.recall * 100).toFixed(0)}%`,
    );
    if (run.phases) console.log(`  ${run.phases}`);
    if (run.lost.length > 0) {
      console.log(`  lost: ${run.lost.map((t) => JSON.stringify(t)).join(", ")}`);
    }
    if (run.offOrigin.length > 0) {
      console.log(`  !! LEFT THE ORIGIN: ${run.offOrigin.join(", ")}`);
    }
  }

  console.log(
    "\nCitation recall is the number that decides. A configuration that is " +
      "faster\nand recovers fewer citations is a regression — see the header " +
      "of this file.",
  );

  console.log(
    "\nRead the worker rows with care. The fixture is ONE page, so there is " +
      "no\nparallelism for a second worker to exploit and the sweep measures " +
      "startup\ncost alone. It says what extra workers cost on a short " +
      "document; it says\nnothing about what they earn on a long one, which " +
      "is what the default is for.\nChanging `workerN` needs a multi-page " +
      "fixture first.",
  );

  console.log(
    "\nAnd these are loopback timings. The engine chunk and the 11 MB model " +
      "arrive\nin milliseconds here, so the warmup in `import/warmup.ts` " +
      "looks worthless —\non a real connection those two downloads are most " +
      "of the wait.",
  );
}

function close(server: Server): void {
  server.close();
}

await main();

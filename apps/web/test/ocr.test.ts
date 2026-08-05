/**
 * The OCR settings, the session cache, and the timings.
 *
 * The browser suite proves recognition works; this covers the logic around it
 * that does not need a browser — and, in the cache's case, a property that is
 * a promise rather than a feature.
 */

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { describe, expect, it, beforeEach } from "vitest";

import {
  cached,
  cacheSize,
  fileKey,
  forgetAll,
  remember,
} from "../src/import/cache.js";
import {
  charsPerSecond,
  describePhases,
  formatMs,
  ImportTimer,
} from "../src/import/metrics.js";
import type { OcrSettings } from "../src/import/ocr-options.js";
import {
  DEFAULT_OCR_SETTINGS,
  OCR_MODES,
  OCR_MODE_HELP,
  OCR_MODE_LABEL,
  ocrSettingsKey,
  scribeOcrPages,
} from "../src/import/ocr-options.js";
import type { ImportResult } from "../src/import/index.js";

const result = (text: string): ImportResult => ({
  text,
  format: "PDF",
  warnings: [],
});

describe("OCR modes", () => {
  it("maps every mode to a value Scribe accepts", () => {
    // Checked against scribe.js-ocr 0.14.3's `extractText` docs, which list
    // 'all' | 'auto' | 'autoShallow' | 'autoDeep' | 'none'.
    const accepted = new Set(["autoShallow", "all", "none"]);
    for (const mode of OCR_MODES) {
      expect(accepted.has(scribeOcrPages(mode)), mode).toBe(true);
    }
  });

  it("labels and explains every mode", () => {
    // A mode the picker can offer but cannot describe renders as `undefined`
    // in front of the user.
    for (const mode of OCR_MODES) {
      expect(OCR_MODE_LABEL[mode]).toBeTruthy();
      expect(OCR_MODE_HELP[mode]).toBeTruthy();
    }
  });

  it("defaults to reading text layers and recognising only scans", () => {
    expect(DEFAULT_OCR_SETTINGS.mode).toBe("auto");
    expect(scribeOcrPages(DEFAULT_OCR_SETTINGS.mode)).toBe("autoShallow");
  });

  it("gives every setting that changes the text its own cache key", () => {
    const base: OcrSettings = { mode: "auto", workers: null };
    const keys = new Set([
      ocrSettingsKey(base),
      ocrSettingsKey({ ...base, mode: "always" }),
      ocrSettingsKey({ ...base, mode: "never" }),
      ocrSettingsKey({ ...base, workers: 2 }),
    ]);
    expect(keys.size).toBe(4);
  });
});

describe("the session cache", () => {
  beforeEach(() => forgetAll());

  it("hashes the bytes, not the name", async () => {
    const a = new File(["identical"], "one.pdf");
    const b = new File(["identical"], "two-different-name.pdf");
    const c = new File(["different"], "one.pdf");

    expect(await fileKey(a, DEFAULT_OCR_SETTINGS)).toBe(
      await fileKey(b, DEFAULT_OCR_SETTINGS),
    );
    expect(await fileKey(a, DEFAULT_OCR_SETTINGS)).not.toBe(
      await fileKey(c, DEFAULT_OCR_SETTINGS),
    );
  });

  it("separates the same file read under different settings", async () => {
    const file = new File(["scan"], "brief.pdf");
    expect(await fileKey(file, { mode: "auto", workers: null })).not.toBe(
      await fileKey(file, { mode: "always", workers: null }),
    );
  });

  it("returns what it was given", () => {
    remember("k", result("Iqbal, 556 U.S. 662 (2009)."));
    expect(cached("k")?.text).toContain("Iqbal");
    expect(cached("missing")).toBeUndefined();
  });

  it("evicts the least recently used entry", () => {
    for (let i = 0; i < 8; i++) remember(`k${i}`, result(`doc ${i}`));
    // Touch the oldest so it is no longer the eviction candidate.
    expect(cached("k0")).toBeDefined();
    remember("k8", result("doc 8"));

    expect(cacheSize()).toBe(8);
    expect(cached("k0"), "k0 was used most recently").toBeDefined();
    expect(cached("k1"), "k1 was the oldest untouched entry").toBeUndefined();
  });

  it("declines to hold a document too large to be worth holding", () => {
    remember("huge", result("x".repeat(2_000_001)));
    expect(cached("huge")).toBeUndefined();
  });

  it("forgets everything when asked", () => {
    remember("k", result("privileged material"));
    forgetAll();
    expect(cached("k")).toBeUndefined();
    expect(cacheSize()).toBe(0);
  });

  it("reaches for no persistent storage at all", () => {
    // README and privacy.html both promise a document is gone when the tab
    // closes. An IndexedDB, localStorage or Cache Storage entry holding a
    // client's recognised filing would make that false — and would leave it
    // readable by the next user of a shared or firm-managed browser profile.
    //
    // Asserted against the source rather than by spying on globals: a spy
    // only catches a write the test happens to trigger, while this catches
    // the API being reachable at all. If this fails, the promise in the docs
    // needs rewriting before the code lands.
    const source = readFileSync(
      fileURLToPath(new URL("../src/import/cache.ts", import.meta.url)),
      "utf8",
    );
    const persistent = /\b(?:indexedDB|localStorage|sessionStorage|caches)\b/.exec(
      source.replace(/^\s*\*.*$/gm, ""),
    );
    expect(persistent?.[0], "cache.ts must hold nothing across a page load").toBe(
      undefined,
    );
  });
});

describe("import metrics", () => {
  it("names each phase and totals them", async () => {
    const timer = new ImportTimer();
    await timer.measure("engine", async () => {
      await new Promise((resolve) => setTimeout(resolve, 5));
    });
    timer.phase("read");

    const metrics = timer.finish({
      bytes: 100,
      chars: 50,
      ocrPages: 1,
      recognised: true,
      engineColdStart: true,
      cacheHit: false,
    });

    expect(metrics.phases.map((p) => p.name)).toEqual(["engine", "read"]);
    expect(metrics.totalMs).toBeGreaterThan(0);
    expect(metrics.chars).toBe(50);
  });

  it("times a phase whose work threw, then rethrows", async () => {
    const timer = new ImportTimer();
    await expect(
      timer.measure("read", () => Promise.reject(new Error("boom"))),
    ).rejects.toThrow("boom");
    // The phase still closed, or a failure would silently vanish from the
    // breakdown and the numbers would not add up.
    const metrics = timer.finish({
      bytes: 0,
      chars: 0,
      ocrPages: 0,
      recognised: false,
      engineColdStart: false,
      cacheHit: false,
    });
    expect(metrics.phases.map((p) => p.name)).toEqual(["read"]);
  });

  it("hands back a copy, so a later phase cannot mutate a reported result", () => {
    const timer = new ImportTimer();
    timer.phase("one");
    const metrics = timer.finish({
      bytes: 0,
      chars: 0,
      ocrPages: 0,
      recognised: false,
      engineColdStart: false,
      cacheHit: false,
    });
    timer.phase("two");
    expect(metrics.phases).toHaveLength(1);
  });

  it("formats durations the way a person reads them", () => {
    expect(formatMs(812)).toBe("812ms");
    expect(formatMs(4_137)).toBe("4.1s");
  });

  it("does not divide by zero", () => {
    const empty = new ImportTimer().finish({
      bytes: 0,
      chars: 0,
      ocrPages: 0,
      recognised: false,
      engineColdStart: false,
      cacheHit: true,
    });
    expect(charsPerSecond(empty)).toBeUndefined();
  });

  it("leaves sub-millisecond phases out of the summary", () => {
    const timer = new ImportTimer();
    timer.phase("instant");
    const metrics = timer.finish({
      bytes: 0,
      chars: 0,
      ocrPages: 0,
      recognised: false,
      engineColdStart: false,
      cacheHit: false,
    });
    // Noise, not information.
    expect(describePhases(metrics)).toBe("");
  });
});

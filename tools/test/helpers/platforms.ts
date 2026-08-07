/**
 * The platforms ReCite claims to work on, and how to open one.
 *
 * A citation checker that runs entirely in the browser is only as portable as
 * the browser it is run in, and the failures that matter are **engine**
 * failures rather than layout ones. An iPhone user reported
 * `undefined is not a function` opening a PDF — a JavaScriptCore message for
 * iterating something that is not iterable — while a Chromium-only suite stayed
 * green, because Chromium is not the engine that broke.
 *
 * So the matrix here is organised by engine, not by screen size, and each entry
 * is honest about what running it does and does not prove:
 *
 * | Engine                  | Relationship to what users run                     |
 * | ----------------------- | -------------------------------------------------- |
 * | Blink + V8              | the engine Chrome and Edge ship                    |
 * | Gecko + SpiderMonkey    | the engine Firefox ships                           |
 * | WebKit + JavaScriptCore | WebKit **trunk**, which is *ahead* of Safari        |
 *
 * That third row is why none of these ids says "iOS" or "Safari". Playwright
 * builds WebKit from the upstream `main` branch, so its JavaScriptCore is the
 * same C++ sources Apple compiles — which is exactly why it can reproduce a
 * `for…of` over a non-iterable, the fault an iPhone reported here. But trunk
 * runs *ahead* of the Safari on anyone's phone, so it cannot see a bug that
 * shipping Safari still has and trunk has already fixed. That is the majority
 * of real iOS bug reports, and it is a blind spot no label should paper over.
 *
 * The phone rows add a device descriptor: viewport, pixel ratio, touch and user
 * agent. Nothing more. Android Chrome genuinely *is* Blink, so `blink-phone` is
 * close to a handset; `webkit-phone` is the right engine family at the right
 * size and is **not an iPhone**. Only a real device or a real Safari can make
 * that claim — see `docs/testing.md`.
 */

import { existsSync, readdirSync } from "node:fs";
import { join } from "node:path";

import type { Browser, LaunchOptions } from "playwright";
import type * as playwrightTypes from "playwright";

export type EngineName = "chromium" | "firefox" | "webkit";

export interface Platform {
  /** Stable id, used as the CI job name and the test title. */
  readonly id: string;
  readonly label: string;
  readonly engine: EngineName;
  readonly family: "desktop" | "android" | "ios";
  /**
   * A Playwright device descriptor, for the mobile rows. Supplies viewport,
   * device pixel ratio, touch and user agent together — picking them by hand
   * is how you end up with a "phone" that reports a desktop user agent.
   */
  readonly device?: string;
}

export const PLATFORMS: readonly Platform[] = [
  {
    id: "desktop-chromium",
    label: "Desktop · Chrome and Edge (Blink, V8)",
    engine: "chromium",
    family: "desktop",
  },
  {
    id: "desktop-firefox",
    label: "Desktop · Firefox (Gecko, SpiderMonkey)",
    engine: "firefox",
    family: "desktop",
  },
  {
    id: "desktop-webkit",
    label: "WebKit trunk and JavaScriptCore — not Safari",
    engine: "webkit",
    family: "desktop",
  },
  {
    id: "blink-phone",
    label: "Blink and V8, phone metrics — not a handset",
    engine: "chromium",
    family: "android",
    device: "Pixel 7",
  },
  {
    id: "webkit-phone",
    label: "WebKit and JavaScriptCore, phone metrics — NOT iOS Safari",
    engine: "webkit",
    family: "ios",
    device: "iPhone 15",
  },
];

/**
 * Where a browser actually is.
 *
 * Playwright's own `executablePath()` is asked first and is what answers on a
 * normal `playwright install`. It is a computed path rather than a lookup,
 * though — it names the revision this Playwright expects — so an environment
 * that pre-installed a *different* revision gets a path to nothing. Rather than
 * pin that revision as a constant, which goes stale silently the next time the
 * image moves, look for whatever revision is actually on disk.
 */
export function executableFor(
  playwright: typeof playwrightTypes,
  engine: EngineName,
): string | undefined {
  const expected = (() => {
    try {
      return playwright[engine].executablePath();
    } catch {
      return undefined;
    }
  })();
  if (expected && existsSync(expected)) return expected;

  const root = process.env["PLAYWRIGHT_BROWSERS_PATH"];
  if (!root || !existsSync(root)) return undefined;

  // `chromium-1194`, `webkit-2336`, and so on. Newest revision wins.
  const candidates = readdirSync(root)
    .filter((entry) => entry.startsWith(`${engine}-`))
    .sort((a, b) => Number(b.split("-")[1]) - Number(a.split("-")[1]));

  for (const candidate of candidates) {
    for (const relative of BINARIES[engine]) {
      const path = join(root, candidate, relative);
      if (existsSync(path)) return path;
    }
  }
  return undefined;
}

/** Where each engine keeps its entry point, across the layouts in the wild. */
const BINARIES: Record<EngineName, readonly string[]> = {
  chromium: [
    join("chrome-linux", "chrome"),
    join("chrome-linux64", "chrome"),
    join("chrome-mac", "Chromium.app", "Contents", "MacOS", "Chromium"),
    join("chrome-win", "chrome.exe"),
  ],
  firefox: [
    join("firefox", "firefox"),
    join("firefox", "Nightly.app", "Contents", "MacOS", "firefox"),
    join("firefox", "firefox.exe"),
  ],
  webkit: [
    "pw_run.sh",
    join("Playwright.app", "Contents", "MacOS", "Playwright"),
    "Playwright.exe",
  ],
};

/**
 * Open a platform, or say why not.
 *
 * Returns `undefined` rather than throwing when the engine is not installed:
 * a contributor with only Chromium should still be able to run the suite and
 * see the rest of it pass, the same way the OCR tests skip without a browser.
 * CI installs all three, and CI is where the full matrix has to be green.
 */
export async function launchPlatform(
  playwright: typeof playwrightTypes,
  platform: Platform,
  options: LaunchOptions = {},
): Promise<Browser | undefined> {
  const executablePath = executableFor(playwright, platform.engine);
  if (!executablePath) return undefined;
  return playwright[platform.engine].launch({
    executablePath,
    // Containers run as root often enough that the sandbox refuses to start,
    // and this only ever opens a fixture served from localhost.
    args: platform.engine === "chromium" ? ["--no-sandbox"] : [],
    ...options,
  });
}

/** Context options for a platform: the device descriptor, where there is one. */
export function contextFor(
  playwright: typeof playwrightTypes,
  platform: Platform,
): Record<string, unknown> {
  if (!platform.device) return {};
  const device = playwright.devices[platform.device];
  if (!device) return {};
  // The descriptor names its own engine; using it against another one would
  // claim a phone the engine cannot be.
  const { defaultBrowserType: _ignored, ...rest } = device;
  return rest;
}

/**
 * Which platforms to run, honouring `RECITE_PLATFORMS`.
 *
 * CI sets it to one id per job so a failure names the platform in the job list
 * rather than in a log. Unset runs everything installed.
 */
export function selectedPlatforms(): readonly Platform[] {
  const requested = process.env["RECITE_PLATFORMS"];
  if (!requested) return PLATFORMS;
  const wanted = new Set(
    requested
      .split(",")
      .map((id) => id.trim())
      .filter(Boolean),
  );
  const chosen = PLATFORMS.filter((platform) => wanted.has(platform.id));
  const unknown = [...wanted].filter((id) => !PLATFORMS.some((p) => p.id === id));
  if (unknown.length > 0) {
    throw new Error(
      `RECITE_PLATFORMS names no such platform: ${unknown.join(", ")}. ` +
        `Known: ${PLATFORMS.map((p) => p.id).join(", ")}`,
    );
  }
  return chosen;
}

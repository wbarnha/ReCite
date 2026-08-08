/**
 * A W3C WebDriver client, in about a hundred lines and with no dependencies.
 *
 * Playwright cannot drive the Safari Apple ships — it relies on patches, so it
 * bundles WebKit from upstream `main` instead. That build is genuinely useful
 * (its JavaScriptCore is Apple's C++ sources) but it runs *ahead* of the Safari
 * on anyone's phone, so it cannot see a bug that shipping Safari still has and
 * trunk has already fixed.
 *
 * The shipping browser is reachable, though: `/usr/bin/safaridriver` is a W3C
 * WebDriver server built into macOS, and WebDriver is a plain HTTP+JSON
 * protocol. So this talks to it with `fetch`. Selenium and WebdriverIO would
 * both do the job and both would be a new dependency in a repository whose
 * runtime tree is four packages and which treats that as a design property.
 *
 * Only the handful of commands the suite actually needs are implemented. The
 * protocol is at https://www.w3.org/TR/webdriver2/ and is stable.
 */

/** The key W3C uses to smuggle an element reference through JSON. */
const ELEMENT_KEY = "element-6066-11e4-a52e-4f735466cecc";

/** The key the pre-standard JSON Wire Protocol used, which remotes still send. */
const LEGACY_ELEMENT_KEY = "ELEMENT";

/**
 * Pull the element reference out of a Find Element reply.
 *
 * Reading only the W3C key looks obviously right and is not: remotes differ on
 * which key they answer with, and some send both. Getting this wrong does not
 * announce itself — the lookup simply returns nothing, which is
 * indistinguishable from "the element is not on the page", and the test fails
 * somewhere else entirely saying `expected undefined`.
 */
function elementIdOf(reply: Record<string, unknown>): string | undefined {
  for (const key of [ELEMENT_KEY, LEGACY_ELEMENT_KEY]) {
    const value = reply[key];
    if (typeof value === "string") return value;
  }
  // A reference under a key neither name predicted. The reply holds exactly one
  // entry, so the single string in it is the reference.
  const values = Object.values(reply).filter((v) => typeof v === "string");
  return values.length === 1 ? values[0] : undefined;
}

interface Envelope<T> {
  readonly value: T;
}

interface RemoteError {
  readonly error: string;
  readonly message: string;
  readonly stacktrace?: string;
}

/** A WebDriver command that came back as an error, with the remote's wording. */
export class WebDriverError extends Error {
  readonly code: string;

  constructor(code: string, message: string) {
    super(`${code}: ${message}`);
    this.name = "WebDriverError";
    this.code = code;
  }
}

async function send<T>(
  base: string,
  method: "POST" | "GET" | "DELETE",
  path: string,
  body?: unknown,
): Promise<T> {
  const response = await fetch(`${base}${path}`, {
    method,
    ...(body === undefined
      ? {}
      : {
          headers: { "content-type": "application/json" },
          body: JSON.stringify(body),
        }),
  });

  const text = await response.text();
  let parsed: unknown;
  try {
    parsed = text ? JSON.parse(text) : {};
  } catch {
    throw new Error(
      `${method} ${path} returned ${response.status} with a body that is not ` +
        `JSON: ${JSON.stringify(text.slice(0, 200))}`,
    );
  }

  const envelope = parsed as Envelope<T>;
  const value = envelope.value;

  // W3C reports failure as a non-2xx status *and* an error object in `value`.
  // Reading the object rather than the status keeps the remote's own wording,
  // which is the whole reason for running the real browser.
  if (
    !response.ok ||
    (typeof value === "object" && value !== null && "error" in value)
  ) {
    const remote = value as RemoteError | undefined;
    throw new WebDriverError(
      remote?.error ?? `http ${response.status}`,
      remote?.message ?? text.slice(0, 300),
    );
  }

  return value;
}

/** Is there a WebDriver server listening? Used to skip rather than fail. */
export async function reachable(base: string, timeoutMs = 2000): Promise<boolean> {
  try {
    const response = await fetch(`${base}/status`, {
      signal: AbortSignal.timeout(timeoutMs),
    });
    return response.ok;
  } catch {
    return false;
  }
}

export class WebDriverSession {
  private constructor(
    private readonly base: string,
    readonly sessionId: string,
    readonly capabilities: Record<string, unknown>,
  ) {}

  static async open(base: string, browserName = "safari"): Promise<WebDriverSession> {
    const created = await send<{
      sessionId: string;
      capabilities: Record<string, unknown>;
    }>(base, "POST", "/session", {
      capabilities: { alwaysMatch: { browserName } },
    });
    return new WebDriverSession(base, created.sessionId, created.capabilities);
  }

  /** What the remote says it is. Printed, so a green run names its browser. */
  describe(): string {
    const text = (key: string, fallback: string): string => {
      const value = this.capabilities[key];
      return typeof value === "string" || typeof value === "number"
        ? String(value)
        : fallback;
    };
    return `${text("browserName", "unknown")} ${text("browserVersion", "?")} on ${text("platformName", "?")}`;
  }

  /**
   * Go to a URL, by way of a blank page.
   *
   * Navigating straight from one page of the app to another leaves the old
   * document readable for a moment, and anything that waits for a marker the
   * old page also had — an `h1`, a heading, a title — matches immediately and
   * hands back a document that is being torn down. Clearing first means a
   * marker can only come from the page that was asked for.
   */
  async navigate(url: string): Promise<void> {
    if (url !== "about:blank") {
      await send(this.base, "POST", `/session/${this.sessionId}/url`, {
        url: "about:blank",
      });
    }
    await send(this.base, "POST", `/session/${this.sessionId}/url`, { url });
  }

  /**
   * Run a script in the page and return its value.
   *
   * The script body is wrapped in a function by the remote, so it must
   * `return` what it wants back. Automation-executed script is not subject to
   * the page's `script-src`, which is why the app's strict CSP does not get in
   * the way here — but it can only run *after* a navigation, which is why
   * load-time errors are collected by a served script instead.
   */
  async execute<T>(script: string, args: readonly unknown[] = []): Promise<T> {
    return send<T>(this.base, "POST", `/session/${this.sessionId}/execute/sync`, {
      script,
      args,
    });
  }

  /** Returns the opaque element id, or `undefined` when there is no match. */
  async find(selector: string): Promise<string | undefined> {
    let found: Record<string, unknown>;
    try {
      found = await send<Record<string, unknown>>(
        this.base,
        "POST",
        `/session/${this.sessionId}/element`,
        { using: "css selector", value: selector },
      );
    } catch (error) {
      if (error instanceof WebDriverError && error.code === "no such element") {
        return undefined;
      }
      throw error;
    }

    const element = elementIdOf(found);
    if (element === undefined) {
      // Loud, and with the evidence in it. A silent `undefined` here reads as
      // "no such element" and sends the reader hunting the page instead of the
      // protocol, which is a whole CI round trip wasted.
      throw new Error(
        `Find Element answered for ${selector} with no recognisable element ` +
          `reference. Keys: ${JSON.stringify(Object.keys(found))}`,
      );
    }
    return element;
  }

  async click(elementId: string): Promise<void> {
    await send(
      this.base,
      "POST",
      `/session/${this.sessionId}/element/${elementId}/click`,
      {},
    );
  }

  /**
   * Type into an element.
   *
   * On an `<input type="file">` this is how W3C says a file is attached: the
   * value is a path on the machine running the browser. Local only, which is
   * exactly the arrangement here.
   */
  async sendKeys(elementId: string, text: string): Promise<void> {
    await send(
      this.base,
      "POST",
      `/session/${this.sessionId}/element/${elementId}/value`,
      { text, value: [...text] },
    );
  }

  async close(): Promise<void> {
    await send(this.base, "DELETE", `/session/${this.sessionId}`).catch(
      () => undefined,
    );
  }
}

/**
 * Wait for an element to exist, then return its id.
 *
 * `find` asks once. WebDriver has no auto-waiting of any kind, and this app
 * renders through React after the document is ready, so a single-shot lookup
 * races the first render — and races it *invisibly*, because a miss is
 * indistinguishable from "the element is not there at all".
 *
 * Existence is checked in the page rather than by retrying `find`, so the
 * handle that comes back always belongs to the document that is current now.
 * A handle taken from a document that has since been replaced is stale, and
 * every use of it fails with a different and more confusing error.
 */
export async function waitForElement(
  session: WebDriverSession,
  selector: string,
  timeoutMs = 30_000,
): Promise<string> {
  await waitFor<boolean>(
    session,
    `return !!document.querySelector(${JSON.stringify(selector)})`,
    (present) => present,
    timeoutMs,
    `an element matching ${selector}`,
  );

  const element = await session.find(selector);
  if (!element) {
    throw new Error(
      `${selector} was in the document and then was not — the page is still changing`,
    );
  }
  return element;
}

/**
 * Poll a page-side expression until it matches, or give up loudly.
 *
 * WebDriver has no equivalent of Playwright's auto-waiting, and the app is
 * asynchronous everywhere that matters — reading a file, running the rule set,
 * decoding a PDF. Polling is the whole of the waiting strategy.
 */
export async function waitFor<T>(
  session: WebDriverSession,
  script: string,
  matches: (value: T) => boolean,
  timeoutMs: number,
  what: string,
): Promise<T> {
  const deadline = Date.now() + timeoutMs;
  let last: T | undefined;

  while (Date.now() < deadline) {
    last = await session.execute<T>(script);
    if (matches(last)) return last;
    await new Promise((resolve) => setTimeout(resolve, 250));
  }

  throw new Error(
    `${what} did not happen within ${timeoutMs}ms. ` +
      `Last value: ${JSON.stringify(last).slice(0, 300)}`,
  );
}

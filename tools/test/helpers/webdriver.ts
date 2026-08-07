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

  async navigate(url: string): Promise<void> {
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
    try {
      const found = await send<Record<string, string>>(
        this.base,
        "POST",
        `/session/${this.sessionId}/element`,
        { using: "css selector", value: selector },
      );
      return found[ELEMENT_KEY];
    } catch (error) {
      if (error instanceof WebDriverError && error.code === "no such element") {
        return undefined;
      }
      throw error;
    }
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

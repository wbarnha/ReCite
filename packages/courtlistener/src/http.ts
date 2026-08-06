/**
 * The one place in ReCite that opens a connection to another origin.
 *
 * Everything else in this repository is offline by construction: `@recite/core`
 * parses, `@recite/rules` decides, `@recite/engine` orchestrates, and none of
 * them can reach a network because nothing in their scope can. This package is
 * deliberately separate so that stays true — `rules` depends on `core`, not on
 * this, so a rule still cannot make a request even by accident.
 *
 * Three properties are enforced here rather than remembered:
 *
 * 1. **A token is required.** There is no anonymous mode. Nothing is sent
 *    unless the person using ReCite pasted a CourtListener token, which is an
 *    explicit act with an explicit consequence.
 * 2. **One host, fixed at compile time.** {@link COURTLISTENER_ORIGIN} is not
 *    configurable from the UI. A caller may point the client at a different
 *    base for a test or a self-hosted mirror, but a document being checked can
 *    never influence where a request goes.
 * 3. **The token never reaches a message.** Errors are read by users and
 *    pasted into issues. {@link redact} runs over every error string.
 */

/** The public CourtListener instance, operated by the Free Law Project. */
export const COURTLISTENER_ORIGIN = "https://www.courtlistener.com";

/**
 * Where a user gets a token.
 *
 * Derived from the origin above rather than written out again, so the whole
 * repository names this host in exactly one place — which is what lets
 * `tools/test/privacy-claims.test.ts` assert that it does.
 */
export const COURTLISTENER_HELP_URL = `${COURTLISTENER_ORIGIN}/help/api/rest/`;

/** Enough of `Response` for this client, so no DOM lib is needed to type it. */
export interface HttpResponse {
  readonly ok: boolean;
  readonly status: number;
  text(): Promise<string>;
}

export interface HttpRequestInit {
  readonly method: string;
  readonly headers: Readonly<Record<string, string>>;
  readonly body?: string;
  readonly signal?: AbortSignal;
}

/**
 * The shape of `fetch` this client needs.
 *
 * Narrowed to what is actually used so tests can supply a plain function, and
 * so the package does not drag the DOM library into a build that has no DOM.
 */
export type FetchLike = (url: string, init: HttpRequestInit) => Promise<HttpResponse>;

export class CourtListenerError extends Error {
  readonly status: number;
  /** True when retrying later could plausibly succeed. */
  readonly transient: boolean;

  constructor(message: string, status: number, transient = false) {
    super(redact(message));
    this.name = "CourtListenerError";
    this.status = status;
    this.transient = transient;
  }
}

/**
 * Remove anything that looks like an API token from a string.
 *
 * CourtListener tokens are 40 hexadecimal characters. An error containing one
 * would otherwise travel into a status line, a saved report, or a public issue
 * — and a token in a bug report is a credential leak whoever filed it did not
 * intend.
 */
export function redact(message: string): string {
  return message
    .replace(/\bToken\s+\S+/gi, "Token …")
    .replace(/\b[0-9a-f]{40}\b/gi, "…");
}

export interface ClientOptions {
  /** A CourtListener API token. Required; there is no anonymous mode. */
  readonly token: string;
  readonly fetch: FetchLike;
  /** Overridable for tests and for a self-hosted mirror. Never from the UI. */
  readonly origin?: string;
  /** Per-request ceiling, in milliseconds. */
  readonly timeoutMs?: number;
}

/**
 * A token that at least has the shape of one.
 *
 * This does not prove the token works — only the server can say that. It
 * exists so a user who pasted their email address, or half a token, is told
 * so immediately instead of watching every citation come back `unchecked`.
 */
export function looksLikeToken(token: string): boolean {
  return /^[0-9a-z]{20,64}$/i.test(token.trim());
}

export class CourtListenerClient {
  readonly origin: string;
  private readonly token: string;
  private readonly fetchImpl: FetchLike;
  private readonly timeoutMs: number;

  constructor(options: ClientOptions) {
    const token = options.token.trim();
    if (!token) {
      throw new CourtListenerError(
        "A CourtListener API token is required. ReCite makes no anonymous requests.",
        0,
      );
    }
    this.token = token;
    this.fetchImpl = options.fetch;
    this.origin = (options.origin ?? COURTLISTENER_ORIGIN).replace(/\/+$/, "");
    this.timeoutMs = options.timeoutMs ?? 15_000;
  }

  /**
   * Send one request and parse the JSON body.
   *
   * `path` is joined to the fixed origin rather than accepted as a URL, so
   * there is no way for a value derived from a document to redirect a request
   * somewhere else.
   */
  async json<T>(
    path: string,
    init: { method?: "GET" | "POST"; form?: Readonly<Record<string, string>> } = {},
  ): Promise<T> {
    if (!path.startsWith("/")) {
      throw new CourtListenerError(`refusing a request to ${path}`, 0);
    }

    const method = init.method ?? "GET";
    const headers: Record<string, string> = {
      Authorization: `Token ${this.token}`,
      Accept: "application/json",
    };

    let body: string | undefined;
    if (init.form) {
      // Form encoding rather than JSON: it is what the citation-lookup
      // endpoint documents, and it keeps the payload trivially inspectable in
      // a browser's network panel — which is how someone verifies for
      // themselves that only a volume, a reporter and a page were sent.
      headers["Content-Type"] = "application/x-www-form-urlencoded";
      body = Object.entries(init.form)
        .map(
          ([key, value]) => `${encodeURIComponent(key)}=${encodeURIComponent(value)}`,
        )
        .join("&");
    }

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeoutMs);

    let response: HttpResponse;
    try {
      response = await this.fetchImpl(`${this.origin}${path}`, {
        method,
        headers,
        ...(body === undefined ? {} : { body }),
        signal: controller.signal,
      });
    } catch (error) {
      throw new CourtListenerError(
        `Could not reach CourtListener: ${describe(error)}`,
        0,
        true,
      );
    } finally {
      clearTimeout(timer);
    }

    if (!response.ok) throw statusError(response.status);

    const raw = await response.text();
    try {
      return JSON.parse(raw) as T;
    } catch {
      throw new CourtListenerError(
        "CourtListener returned something that is not JSON. This usually means a " +
          "proxy answered instead of the API.",
        response.status,
      );
    }
  }
}

/** Turn an HTTP status into a sentence that says what to do about it. */
function statusError(status: number): CourtListenerError {
  if (status === 401 || status === 403) {
    return new CourtListenerError(
      "CourtListener rejected the API token. Check it at " +
        "courtlistener.com/profile/api-tokens/ and paste it again.",
      status,
    );
  }
  if (status === 429) {
    return new CourtListenerError(
      "CourtListener is rate-limiting this token. Wait a minute and check the " +
        "rest of the document.",
      status,
      true,
    );
  }
  if (status >= 500) {
    return new CourtListenerError(
      `CourtListener returned ${status}. That is their side, not yours.`,
      status,
      true,
    );
  }
  return new CourtListenerError(`CourtListener returned ${status}.`, status);
}

function describe(error: unknown): string {
  if (error instanceof Error) {
    return error.name === "AbortError" ? "the request timed out" : error.message;
  }
  return String(error);
}

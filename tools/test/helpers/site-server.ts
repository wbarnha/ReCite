/**
 * Serve the built site the way GitHub Pages does.
 *
 * Shared by the browser suite and the OCR benchmark, which need the same
 * thing: `dist/` under a sub-path, with the cross-origin isolation headers
 * Scribe's workers want. Keeping one copy means the benchmark measures the
 * same conditions the tests assert against, rather than a near-miss of them.
 */

import { existsSync, readFileSync } from "node:fs";
import { createServer, type Server } from "node:http";
import { dirname, extname, join, normalize } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
export const ROOT = join(HERE, "..", "..", "..");
export const DIST = join(ROOT, "apps", "web", "dist");

/** The site is served from a sub-path on Pages, so this does too. */
export const BASE_PATH = "/ReCite/";

const MIME: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  // pdf.js ships its worker as `.mjs`. Serving it as octet-stream makes
  // Chromium refuse it under strict MIME checking for module scripts — which
  // looks exactly like a broken engine and is a broken fixture. Pages serves
  // it correctly; this has to as well or the test is not testing production.
  ".mjs": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".wasm": "application/wasm",
  ".json": "application/json",
  ".gz": "application/gzip",
  ".xml": "application/xml",
  ".map": "application/json",
};

/**
 * Whether there is a build to serve.
 *
 * Only the build. Whether there is a browser to run it in is a separate
 * question with a separate answer per engine, and conflating the two meant a
 * missing Chromium reported itself as "the site is not built".
 */
export function siteIsBuilt(): boolean {
  return existsSync(join(DIST, "index.html"));
}

/**
 * Where the error collector is served from, when it is asked for.
 *
 * A separate file rather than an inline script, because the app ships
 * `script-src 'self' 'wasm-unsafe-eval'` with no `'unsafe-inline'` — an inline
 * collector would be refused by the very policy the app is proud of, and the
 * suite would report a clean page while the browser blocked its instrument.
 */
export const COLLECTOR_PATH = "__recite-errors.js";

/**
 * Catch what a page throws, for drivers that cannot tell you.
 *
 * Playwright has `pageerror`. W3C WebDriver has nothing of the kind, so an
 * uncaught exception in the app is invisible to it — the symptom is a later
 * assertion timing out, with no clue why. Recording errors as they happen and
 * reading them back afterwards is the only way to make a real Safari say what
 * went wrong.
 *
 * Loaded first so it is installed before any application module evaluates,
 * which is where the interesting failures are.
 */
const COLLECTOR = `(function () {
  var recorded = [];
  window.__reciteErrors = recorded;
  window.addEventListener("error", function (event) {
    recorded.push(
      String(event.message || (event.error && event.error.message) || event.type) +
        (event.filename ? " (" + event.filename + ":" + event.lineno + ")" : "")
    );
  });
  window.addEventListener("unhandledrejection", function (event) {
    var reason = event.reason;
    recorded.push(
      "unhandled rejection: " +
        String((reason && (reason.message || reason)) || "unknown")
    );
  });
})();
`;

export interface ServeOptions {
  /**
   * Serve {@link COLLECTOR_PATH} and reference it from `index.html`.
   *
   * Off by default: it changes the bytes of the served page, and the suites
   * that assert on subresource integrity or on what the page requests must see
   * the published article untouched.
   */
  readonly collectErrors?: boolean;
}

export function serveSite(
  options: ServeOptions = {},
): Promise<{ server: Server; origin: string }> {
  const server = createServer((request, response) => {
    const url = new URL(request.url ?? "/", "http://localhost");
    let path = decodeURIComponent(url.pathname);

    if (!path.startsWith(BASE_PATH)) {
      response.writeHead(404).end("outside the base path");
      return;
    }
    path = path.slice(BASE_PATH.length) || "index.html";

    if (options.collectErrors && path === COLLECTOR_PATH) {
      response.writeHead(200, { "Content-Type": MIME[".js"]! });
      response.end(COLLECTOR);
      return;
    }

    // The served tree is a fixture, but treating a request path as safe is a
    // habit worth not having.
    const target = join(DIST, normalize(path).replace(/^(?:\.\.[/\\])+/, ""));
    if (!target.startsWith(DIST) || !existsSync(target)) {
      response.writeHead(404).end("not found");
      return;
    }

    let body = readFileSync(target);
    if (options.collectErrors && path === "index.html") {
      // First thing in `<head>`, so it is listening before the app runs.
      body = Buffer.from(
        body
          .toString("utf8")
          .replace("<head>", `<head>\n    <script src="${COLLECTOR_PATH}"></script>`),
        "utf8",
      );
    }

    response.writeHead(200, {
      "Content-Type": MIME[extname(target)] ?? "application/octet-stream",
      // Scribe's workers want these for SharedArrayBuffer; harmless otherwise.
      "Cross-Origin-Opener-Policy": "same-origin",
      "Cross-Origin-Embedder-Policy": "require-corp",
      "Cross-Origin-Resource-Policy": "same-origin",
    });
    response.end(body);
  });

  return new Promise((resolve) => {
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      const port = typeof address === "object" && address ? address.port : 0;
      resolve({ server, origin: `http://127.0.0.1:${port}` });
    });
  });
}

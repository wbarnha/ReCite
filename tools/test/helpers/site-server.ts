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

/** Pre-installed by the environment; Playwright is told not to download one. */
export const CHROMIUM = "/opt/pw-browsers/chromium-1194/chrome-linux/chrome";

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

/** Whether there is a build and a browser to run it in. */
export function siteIsBuilt(): boolean {
  return existsSync(join(DIST, "index.html")) && existsSync(CHROMIUM);
}

export function serveSite(): Promise<{ server: Server; origin: string }> {
  const server = createServer((request, response) => {
    const url = new URL(request.url ?? "/", "http://localhost");
    let path = decodeURIComponent(url.pathname);

    if (!path.startsWith(BASE_PATH)) {
      response.writeHead(404).end("outside the base path");
      return;
    }
    path = path.slice(BASE_PATH.length) || "index.html";

    // The served tree is a fixture, but treating a request path as safe is a
    // habit worth not having.
    const target = join(DIST, normalize(path).replace(/^(?:\.\.[/\\])+/, ""));
    if (!target.startsWith(DIST) || !existsSync(target)) {
      response.writeHead(404).end("not found");
      return;
    }

    response.writeHead(200, {
      "Content-Type": MIME[extname(target)] ?? "application/octet-stream",
      // Scribe's workers want these for SharedArrayBuffer; harmless otherwise.
      "Cross-Origin-Opener-Policy": "same-origin",
      "Cross-Origin-Embedder-Policy": "require-corp",
      "Cross-Origin-Resource-Policy": "same-origin",
    });
    response.end(readFileSync(target));
  });

  return new Promise((resolve) => {
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      const port = typeof address === "object" && address ? address.port : 0;
      resolve({ server, origin: `http://127.0.0.1:${port}` });
    });
  });
}

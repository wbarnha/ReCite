/**
 * The shared shell for ReCite's static pages.
 *
 * The privacy policy, terms and support pages are required by AppSource and
 * are read by people deciding whether a tool is safe to put in front of
 * privileged material. They are generated rather than hand-written three times
 * so the chrome cannot drift between them, but the prose lives in plain
 * TypeScript next door and reads as prose — a policy nobody can find in the
 * source is not much of a policy.
 *
 * Each page is entirely self-contained: no scripts, no external stylesheet, no
 * fonts, no images. A compliance document that fails to render because an
 * asset moved would be worse than a plain one, and `default-src 'none'` is
 * only credible if there is genuinely nothing to load.
 */

export interface Page {
  /** Output filename, e.g. `privacy.html`. */
  readonly file: string;
  readonly title: string;
  /** Shown under the heading. */
  readonly heading: string;
  /** The pull quote at the top, already escaped. */
  readonly lede?: string;
  /** Body HTML. Written by hand in `content.ts`. */
  readonly body: string;
}

/** The date these documents state. Passed in so a build is reproducible. */
export const LAST_UPDATED = "5 August 2026";

const STYLE = `
  :root {
    color-scheme: light dark;
    --fg: #1a1a1a;
    --bg: #ffffff;
    --muted: #5a5a5a;
    --rule: #e2e2e2;
    --accent: #1f4e79;
    --panel: #f6f8fa;
  }
  @media (prefers-color-scheme: dark) {
    :root {
      --fg: #e8e8e8;
      --bg: #16181c;
      --muted: #a0a4ab;
      --rule: #2c3037;
      --accent: #7fb3e0;
      --panel: #1d2026;
    }
  }
  * { box-sizing: border-box; }
  body {
    margin: 0 auto;
    max-width: 44rem;
    padding: 3rem 1.25rem 5rem;
    background: var(--bg);
    color: var(--fg);
    font: 16px/1.65 -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, system-ui, sans-serif;
  }
  h1 { font-size: 1.7rem; margin: 0 0 0.25rem; }
  h2 {
    font-size: 1.15rem;
    margin: 2.5rem 0 0.5rem;
    padding-top: 1rem;
    border-top: 1px solid var(--rule);
  }
  h3 { font-size: 1rem; margin: 1.5rem 0 0.4rem; }
  .updated { color: var(--muted); font-size: 0.9rem; margin: 0 0 2rem; }
  .lede {
    font-size: 1.05rem;
    border-left: 3px solid var(--accent);
    padding-left: 1rem;
    margin: 1.5rem 0 2rem;
  }
  .panel {
    background: var(--panel);
    border: 1px solid var(--rule);
    border-radius: 6px;
    padding: 0.75rem 1rem;
    margin: 1.25rem 0;
  }
  table { border-collapse: collapse; width: 100%; margin: 1rem 0; font-size: 0.95rem; }
  th, td {
    text-align: left;
    padding: 0.5rem 0.75rem 0.5rem 0;
    border-bottom: 1px solid var(--rule);
    vertical-align: top;
  }
  th { font-weight: 600; }
  code { font-family: ui-monospace, SFMono-Regular, Menlo, monospace; font-size: 0.9em; }
  a { color: var(--accent); }
  ul { padding-left: 1.25rem; }
  li { margin: 0.3rem 0; }
  .wrap { overflow-x: auto; }
  footer {
    margin-top: 3rem;
    padding-top: 1rem;
    border-top: 1px solid var(--rule);
    color: var(--muted);
    font-size: 0.9rem;
  }
`;

/**
 * Escape text for HTML. Everything interpolated into a page goes through this.
 */
export function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

export function renderPage(page: Page): string {
  const lede = page.lede ? `\n    <p class="lede">${page.lede}</p>\n` : "";

  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <!-- Nothing to load and nothing to run. \`connect-src 'none'\` is the same
         guarantee the application itself makes, stated on the page that
         describes it. -->
    <meta
      http-equiv="Content-Security-Policy"
      content="default-src 'none'; script-src 'none'; style-src 'unsafe-inline'; connect-src 'none'; base-uri 'none'; form-action 'none'"
    />
    <meta name="robots" content="index, follow" />
    <title>${escapeHtml(page.title)}</title>
    <style>${STYLE}</style>
  </head>
  <body>
    <h1>${escapeHtml(page.heading)}</h1>
    <p class="updated">ReCite &middot; last updated ${escapeHtml(LAST_UPDATED)}</p>
${lede}${page.body}
    <footer>
      <p>
        <a href="./">ReCite</a> &middot;
        <a href="tutorial.html">Walkthrough</a> &middot;
        <a href="privacy.html">Privacy</a> &middot;
        <a href="terms.html">Terms</a> &middot;
        <a href="support.html">Support</a> &middot;
        <a href="https://github.com/wbarnha/ReCite">Source</a>
      </p>
    </footer>
  </body>
</html>
`;
}

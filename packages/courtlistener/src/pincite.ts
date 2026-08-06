/**
 * Reading the page a pin cite points at.
 *
 * `Iqbal, 556 U.S. 662, 678` says "page 678 of volume 556". CourtListener
 * publishes opinions with **star pagination** — the markers, written `*678`,
 * that record where the reporter's printed pages began. Finding the marker is
 * what turns a pin cite into an actual passage.
 *
 * The rule this module is built around: **no marker, no quotation.** An
 * opinion without star pagination is common (a slip opinion, a
 * database-only decision, a court that publishes its own PDFs), and guessing
 * which paragraph is "roughly page 678" would put a misattributed quotation
 * into somebody's brief. Every path that cannot find the page returns a note
 * saying so instead.
 */

import type { CourtListenerClient } from "./http.js";
import type { PinciteQuotation } from "./model.js";

/** Longest quotation ReCite will pull. A comment, not an excerpt. */
export const DEFAULT_QUOTE_CHARS = 420;

/** The opinion fields worth asking for, best first. */
interface RawOpinion {
  readonly id?: number;
  readonly absolute_url?: string;
  readonly html_with_citations?: string | null;
  readonly html_columbia?: string | null;
  readonly html_lawbox?: string | null;
  readonly xml_harvard?: string | null;
  readonly html?: string | null;
  readonly plain_text?: string | null;
}

/**
 * The path for an opinion URL that belongs to this origin.
 *
 * `sub_opinions` arrives from the network as a list of absolute URLs. Following
 * one blindly would let a response decide where the next request goes, so a URL
 * pointing anywhere but the configured origin is refused rather than followed.
 */
export function opinionPath(url: string, origin: string): string | undefined {
  if (!url.startsWith(`${origin}/`)) return undefined;
  const path = url.slice(origin.length);
  return /^\/api\/rest\/v\d+\/opinions\/\d+\/$/.test(path) ? path : undefined;
}

// --------------------------------------------------------------- markup ---

const NAMED_ENTITIES: Readonly<Record<string, string>> = {
  amp: "&",
  lt: "<",
  gt: ">",
  quot: '"',
  apos: "'",
  nbsp: " ",
  mdash: "—",
  ndash: "–",
  ldquo: "“",
  rdquo: "”",
  lsquo: "‘",
  rsquo: "’",
  sect: "§",
  para: "¶",
};

export function decodeEntities(value: string): string {
  return value.replace(/&(#x?[0-9a-f]+|[a-z]+);/gi, (whole, body: string) => {
    if (body.startsWith("#")) {
      const hex = body[1] === "x" || body[1] === "X";
      const code = Number.parseInt(hex ? body.slice(2) : body.slice(1), hex ? 16 : 10);
      return Number.isFinite(code) && code > 0 && code <= 0x10ffff
        ? String.fromCodePoint(code)
        : whole;
    }
    return NAMED_ENTITIES[body.toLowerCase()] ?? whole;
  });
}

/**
 * Markup to text, keeping star pagination and nothing else.
 *
 * Both markup dialects CourtListener serves are normalised to the same
 * `*678` form the plain-text version already uses, so the search below has one
 * shape to look for rather than three.
 */
export function markupToText(markup: string): string {
  return (
    markup
      // Anything that is code rather than prose, content and all.
      .replace(/<(script|style)\b[^>]*>[\s\S]*?<\/\1>/gi, " ")
      // `html_with_citations` and the Columbia/Lawbox HTML.
      .replace(
        /<span[^>]*class="[^"]*star-pagination[^"]*"[^>]*>[\s*]*(\d+)\s*<\/span>/gi,
        "\n*$1\n",
      )
      // Harvard XML.
      .replace(
        /<page-number[^>]*label="(\d+)"[^>]*>[\s\S]*?<\/page-number>/gi,
        "\n*$1\n",
      )
      // `<br>` is the only opening tag that breaks a line. Breaking on both
      // the open and the close of a `<p>` would put a blank line between every
      // pair of paragraphs, which is how this was wrong the first time.
      .replace(/<br\b[^>]*>/gi, "\n")
      // Block tags end a line as they close. Spelled out as an alternation of
      // literals rather than matched as "any tag name", because a general name
      // class next to `[^>]*` is exactly the ambiguity `eslint-plugin-regexp`
      // is here to catch — and opinion markup is attacker-adjacent input.
      .replace(
        /<\/(?:p|div|blockquote|li|tr|h[1-6]|section|article|footnote)\s*>/gi,
        "\n",
      )
      .replace(
        /<(?:p|div|blockquote|li|tr|h[1-6]|section|article|footnote)\b[^>]*\/>/gi,
        "\n",
      )
      // Everything left is inline, and contributes nothing but its text.
      .replace(/<[^>]*>/g, "")
      .split("\n")
      .map((line) =>
        decodeEntities(line)
          .replace(/[^\S\n]+/g, " ")
          .trim(),
      )
      .join("\n")
      .replace(/\n{3,}/g, "\n\n")
      .trim()
  );
}

// -------------------------------------------------------------- quoting ---

/**
 * The passage that begins at `*page`.
 *
 * Returns `undefined` when the marker is absent, which is the honest answer
 * far more often than it is a bug.
 */
export function quoteAtPage(
  text: string,
  page: string,
  maxChars = DEFAULT_QUOTE_CHARS,
): string | undefined {
  if (!/^\d+$/.test(page)) return undefined;

  // Anchored on a boundary before the star so `*67` inside `*678` cannot
  // match, and `(?!\d)` so `*678` does not match the start of `*6789`.
  const marker = new RegExp(`(?:^|[\\s(\\[])\\*${page}(?!\\d)`, "m");
  const at = marker.exec(text);
  if (!at) return undefined;

  const from = at.index + at[0].length;
  return tidyQuotation(text.slice(from, from + maxChars * 2), maxChars);
}

/**
 * The opening of the opinion, for a pin cite to its own first page.
 *
 * A citation like `556 U.S. 662, 662` points at the page the opinion starts
 * on, which is exactly the page that carries no star marker — the marker
 * records where a *new* page began. Handled explicitly rather than reported as
 * missing, because "the first page is not in the opinion" is nonsense to read.
 */
export function quoteFromStart(text: string, maxChars = DEFAULT_QUOTE_CHARS): string {
  return tidyQuotation(text.slice(0, maxChars * 2), maxChars);
}

/** Trim to a sentence where possible, and to a word where not. */
export function tidyQuotation(raw: string, maxChars: number): string {
  const flat = raw.replace(/\s+/g, " ").trim();
  if (flat.length <= maxChars) return flat;

  const window = flat.slice(0, maxChars);
  // A sentence end late enough in the window to be worth cutting to. Below
  // 40% the quotation gets so short it stops carrying the point.
  const sentence = /.*[.?!]["”’)]?(?=\s)/s.exec(window)?.[0] ?? "";
  if (sentence.length >= maxChars * 0.4) return sentence.trim();

  const space = window.lastIndexOf(" ");
  return `${(space > 0 ? window.slice(0, space) : window).trim()}…`;
}

// ------------------------------------------------------------- fetching ---

export interface PinciteOptions {
  readonly maxChars?: number;
  /** Called before each opinion request, so the caller can rate-limit. */
  readonly beforeRequest?: () => Promise<void>;
  /**
   * The page the opinion itself starts on, from the citation being checked.
   *
   * Supplying it is what makes `556 U.S. 662, 662` work: that page carries no
   * star marker, because a marker records where a *new* page began.
   */
  readonly firstPage?: string;
}

/**
 * Fetch the opinions of one cluster and quote the page a pin cite names.
 *
 * A cluster can hold several opinions — a majority, a concurrence, a dissent —
 * and the pin cite may fall in any of them, so each is tried in the order
 * CourtListener lists them until one carries the page.
 */
export async function quotePincite(
  client: CourtListenerClient,
  opinionUrls: readonly string[],
  page: string,
  clusterUrl: string | undefined,
  options: PinciteOptions = {},
): Promise<PinciteQuotation> {
  const maxChars = options.maxChars ?? DEFAULT_QUOTE_CHARS;
  const url = clusterUrl ? `${clusterUrl}#p${page}` : undefined;
  const base = { page, ...(url ? { url } : {}) };

  const paths = opinionUrls
    .map((candidate) => opinionPath(candidate, client.origin))
    .filter((path): path is string => path !== undefined);

  if (paths.length === 0) {
    return { ...base, note: "CourtListener listed no opinion text for this case." };
  }

  /** The first opinion that had any text, kept for the first-page case. */
  let leading: string | undefined;

  for (const path of paths) {
    await options.beforeRequest?.();

    let opinion: RawOpinion;
    try {
      opinion = await client.json<RawOpinion>(path);
    } catch (error) {
      return {
        ...base,
        note: error instanceof Error ? error.message : String(error),
      };
    }

    const body = bestBody(opinion);
    if (!body) continue;

    const text = markupToText(body);
    leading ??= text;

    const quote = quoteAtPage(text, page, maxChars);
    if (quote) return { ...base, text: quote };
  }

  if (leading === undefined) {
    return { ...base, note: "CourtListener holds no text for this opinion." };
  }
  if (options.firstPage !== undefined && options.firstPage === page) {
    return {
      ...base,
      text: quoteFromStart(leading, maxChars),
      note: `Page ${page} is where the opinion begins, so this is its opening.`,
    };
  }
  return {
    ...base,
    unpaginated: true,
    note:
      `Page ${page} is not marked in CourtListener's copy of this opinion, so ` +
      "ReCite has not guessed at a passage. Check the reporter.",
  };
}

/** The richest text CourtListener holds for an opinion. */
export function bestBody(opinion: RawOpinion): string | undefined {
  for (const candidate of [
    opinion.html_with_citations,
    opinion.html_columbia,
    opinion.html_lawbox,
    opinion.xml_harvard,
    opinion.html,
    opinion.plain_text,
  ]) {
    if (candidate && candidate.trim()) return candidate;
  }
  return undefined;
}

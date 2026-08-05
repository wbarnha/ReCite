/**
 * Writing a text-only PDF.
 *
 * Hand-written rather than taken from a library, and the reasoning is the same
 * as everywhere else here: the alternative is a dependency on the code path
 * that handles a client's document, to produce a file that is a few hundred
 * lines of well-specified format.
 *
 * It uses Helvetica, which is one of the fourteen fonts every PDF reader is
 * required to have built in, so nothing is embedded and the output stays
 * small. That also fixes the character set: PDF's standard encodings are
 * single-byte, so text is written as WinAnsi and the characters outside it are
 * transliterated rather than dropped — see {@link toWinAnsi}. Losing an en
 * dash out of a page range would change the citation.
 */

/** 8.5 × 11 inches at 72 units to the inch. */
const PAGE_WIDTH = 612;
const PAGE_HEIGHT = 792;
const MARGIN = 72;
const FONT_SIZE = 11;
const LINE_HEIGHT = 15.5;

const USABLE_WIDTH = PAGE_WIDTH - MARGIN * 2;
const LINES_PER_PAGE = Math.floor((PAGE_HEIGHT - MARGIN * 2) / LINE_HEIGHT);

/**
 * Helvetica advance widths, in 1/1000 em, for the printable ASCII range.
 *
 * Wrapping needs real widths: measuring in characters puts `Illinois` and
 * `WWWWWWWW` at the same length and produces lines that overflow the margin.
 */
const WIDTHS: Record<string, number> = {
  " ": 278,
  "!": 278,
  '"': 355,
  "#": 556,
  $: 556,
  "%": 889,
  "&": 667,
  "'": 191,
  "(": 333,
  ")": 333,
  "*": 389,
  "+": 584,
  ",": 278,
  "-": 333,
  ".": 278,
  "/": 278,
  "0": 556,
  "1": 556,
  "2": 556,
  "3": 556,
  "4": 556,
  "5": 556,
  "6": 556,
  "7": 556,
  "8": 556,
  "9": 556,
  ":": 278,
  ";": 278,
  "<": 584,
  "=": 584,
  ">": 584,
  "?": 556,
  "@": 1015,
  A: 667,
  B: 667,
  C: 722,
  D: 722,
  E: 667,
  F: 611,
  G: 778,
  H: 722,
  I: 278,
  J: 500,
  K: 667,
  L: 556,
  M: 833,
  N: 722,
  O: 778,
  P: 667,
  Q: 778,
  R: 722,
  S: 667,
  T: 611,
  U: 722,
  V: 667,
  W: 944,
  X: 667,
  Y: 667,
  Z: 611,
  "[": 278,
  "\\": 278,
  "]": 278,
  "^": 469,
  _: 556,
  "`": 333,
  a: 556,
  b: 556,
  c: 500,
  d: 556,
  e: 556,
  f: 278,
  g: 556,
  h: 556,
  i: 222,
  j: 222,
  k: 500,
  l: 222,
  m: 833,
  n: 556,
  o: 556,
  p: 556,
  q: 556,
  r: 333,
  s: 500,
  t: 278,
  u: 556,
  v: 500,
  w: 722,
  x: 500,
  y: 500,
  z: 500,
  "{": 334,
  "|": 260,
  "}": 334,
  "~": 584,
};

const DEFAULT_WIDTH = 556;

function textWidth(text: string): number {
  let total = 0;
  for (const ch of text) total += WIDTHS[ch] ?? DEFAULT_WIDTH;
  return (total * FONT_SIZE) / 1000;
}

/**
 * Map characters PDF's single-byte encoding cannot hold onto ones it can.
 *
 * Dashes matter most: a page range written with an en dash is a citation, and
 * silently dropping the dash would turn `371–72` into `37172`. Curly quotes
 * and the section sign get the same treatment rather than disappearing.
 */
const TRANSLITERATE: Record<string, string> = {
  "‘": "'",
  "’": "'",
  "“": '"',
  "”": '"',
  "–": "-",
  "—": "--",
  "‒": "-",
  "‐": "-",
  "‑": "-",
  "―": "--",
  "−": "-",
  "…": "...",
  " ": " ",
  " ": " ",
  " ": " ",
  "§": "§",
  "¶": "¶",
  "•": "-",
};

export function toWinAnsi(text: string): string {
  let out = "";
  for (const ch of text) {
    const mapped = TRANSLITERATE[ch];
    if (mapped !== undefined) {
      out += mapped;
      continue;
    }
    const code = ch.codePointAt(0) ?? 0;
    // Latin-1 and the printable ASCII range survive as themselves; anything
    // else becomes a question mark rather than a broken glyph.
    out += code <= 0xff ? ch : "?";
  }
  return out;
}

/** Escape the three characters that are special inside a PDF string. */
function escapePdfString(text: string): string {
  return text.replace(/\\/g, "\\\\").replace(/\(/g, "\\(").replace(/\)/g, "\\)");
}

/** Break a paragraph into lines that fit the text column. */
export function wrap(paragraph: string, width = USABLE_WIDTH): string[] {
  if (!paragraph) return [""];

  const lines: string[] = [];
  let current = "";

  for (const word of paragraph.split(/ +/)) {
    const candidate = current ? `${current} ${word}` : word;
    if (textWidth(candidate) <= width || !current) {
      current = candidate;
      continue;
    }
    lines.push(current);
    current = word;
  }
  if (current) lines.push(current);

  return lines;
}

/** Split wrapped lines into pages. */
function paginate(text: string): string[][] {
  const lines = toWinAnsi(text)
    .replace(/\r\n?/g, "\n")
    .replace(/\t/g, "    ")
    .split("\n")
    .flatMap((paragraph) => wrap(paragraph));

  const pages: string[][] = [];
  for (let i = 0; i < lines.length; i += LINES_PER_PAGE) {
    pages.push(lines.slice(i, i + LINES_PER_PAGE));
  }
  return pages.length > 0 ? pages : [[""]];
}

export function writePdf(text: string): Blob {
  const pages = paginate(text);

  // Object 1 catalog, 2 pages, 3 font, then a content stream and a page object
  // per page.
  const contentIds = pages.map((_, index) => 4 + index * 2);
  const pageIds = pages.map((_, index) => 5 + index * 2);

  const objects: string[] = [];
  objects.push(`<< /Type /Catalog /Pages 2 0 R >>`);
  objects.push(
    `<< /Type /Pages /Kids [${pageIds.map((id) => `${id} 0 R`).join(" ")}] /Count ${pages.length} >>`,
  );
  objects.push(
    `<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>`,
  );

  pages.forEach((lines, index) => {
    const body = lines
      .map(
        (line, row) =>
          `1 0 0 1 ${MARGIN} ${PAGE_HEIGHT - MARGIN - row * LINE_HEIGHT} Tm (${escapePdfString(line)}) Tj`,
      )
      .join("\n");
    const stream = `BT /F1 ${FONT_SIZE} Tf\n${body}\nET`;

    objects.push(`<< /Length ${stream.length} >>\nstream\n${stream}\nendstream`);
    objects.push(
      `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${PAGE_WIDTH} ${PAGE_HEIGHT}] ` +
        `/Resources << /Font << /F1 3 0 R >> >> /Contents ${contentIds[index]!} 0 R >>`,
    );
  });

  // --- assemble, recording offsets for the cross-reference table ---
  let out = "%PDF-1.4\n";
  const offsets: number[] = [];

  objects.forEach((body, index) => {
    offsets.push(out.length);
    out += `${index + 1} 0 obj\n${body}\nendobj\n`;
  });

  const xrefStart = out.length;
  out += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  for (const offset of offsets) {
    out += `${String(offset).padStart(10, "0")} 00000 n \n`;
  }
  out += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xrefStart}\n%%EOF\n`;

  // latin1 so every byte written is the byte counted: the cross-reference
  // offsets above are string indices, and a UTF-8 encoder would shift them.
  const bytes = new Uint8Array(out.length);
  for (let i = 0; i < out.length; i++) bytes[i] = out.charCodeAt(i) & 0xff;

  return new Blob([bytes], { type: "application/pdf" });
}

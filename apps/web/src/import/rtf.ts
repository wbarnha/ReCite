/**
 * Text out of Rich Text Format.
 *
 * RTF is plain ASCII with control words, so no decompression and no XML — but
 * it has three traps worth naming, because getting any of them wrong corrupts
 * citations specifically rather than failing loudly:
 *
 * 1. **Destination groups.** `\fonttbl`, `\colortbl`, `\stylesheet`, `\info`
 *    and anything introduced by `\*` contain text that is not document text.
 *    Emitting it splices font names into the middle of the brief.
 * 2. **`\'xx` hex escapes.** Every non-ASCII character in a legacy RTF arrives
 *    this way. A section sign in `11 U.S.C. § 362` is `\'a7`, and dropping it
 *    silently changes the citation.
 * 3. **`\uN` Unicode escapes with a fallback.** These are followed by
 *    replacement characters that must be skipped, or every em dash becomes
 *    `—?` and every page range parses wrong.
 */

/** Groups whose contents are metadata rather than document text. */
const SKIPPED_DESTINATIONS = new Set([
  "fonttbl",
  "colortbl",
  "stylesheet",
  "listtable",
  "listoverridetable",
  "revtbl",
  "rsidtbl",
  "generator",
  "info",
  "pict",
  "object",
  "themedata",
  "colorschememapping",
  "latentstyles",
  "datastore",
  "xmlnstbl",
  "filetbl",
  "fchars",
  "lchars",
]);

/** Control words that produce whitespace or punctuation. */
const LITERALS: Record<string, string> = {
  par: "\n",
  line: "\n",
  sect: "\n\n",
  page: "\n\n",
  tab: "\t",
  emdash: "—",
  endash: "–",
  emspace: " ",
  enspace: " ",
  lquote: "‘",
  rquote: "’",
  ldblquote: "“",
  rdblquote: "”",
  bullet: "•",
  nbsp: " ",
  "~": " ",
  "-": "",
  _: "‑",
};

export function readRtf(source: string): string {
  const out: string[] = [];

  // One frame per `{`. `skip` is inherited: a destination nested inside a
  // skipped destination stays skipped.
  const stack: Array<{ skip: boolean; ucSkip: number }> = [{ skip: false, ucSkip: 1 }];
  let frame = stack[0]!;

  let i = 0;
  // Characters still to be swallowed after a `\uN` fallback.
  let pendingSkip = 0;

  const emit = (text: string) => {
    if (frame.skip) return;
    if (pendingSkip > 0) {
      // The fallback for a `\uN` is counted in characters, not bytes.
      const consumed = Math.min(pendingSkip, text.length);
      pendingSkip -= consumed;
      text = text.slice(consumed);
      if (!text) return;
    }
    out.push(text);
  };

  while (i < source.length) {
    const ch = source[i];

    if (ch === "{") {
      frame = { skip: frame.skip, ucSkip: frame.ucSkip };
      stack.push(frame);
      i++;
      continue;
    }

    if (ch === "}") {
      if (stack.length > 1) stack.pop();
      frame = stack[stack.length - 1]!;
      pendingSkip = 0;
      i++;
      continue;
    }

    if (ch !== "\\") {
      if (ch === "\n" || ch === "\r") {
        // A bare newline in the source is formatting, not content.
        i++;
        continue;
      }
      emit(ch!);
      i++;
      continue;
    }

    // --- a control sequence ---
    const nextChar = source[i + 1];

    // `\*` marks a destination the reader may ignore if it does not know it.
    if (nextChar === "*") {
      frame.skip = true;
      i += 2;
      continue;
    }

    // Escaped literals: `\\`, `\{`, `\}`.
    if (nextChar === "\\" || nextChar === "{" || nextChar === "}") {
      emit(nextChar);
      i += 2;
      continue;
    }

    // `\'xx` — one byte, hex.
    if (nextChar === "'") {
      const hex = source.slice(i + 2, i + 4);
      const code = Number.parseInt(hex, 16);
      if (Number.isFinite(code)) {
        // Windows-1252 is the near-universal RTF code page, and differs from
        // Latin-1 exactly in the range that holds curly quotes and dashes —
        // the characters a citation checker cares about most.
        emit(CP1252[code - 0x80] ?? String.fromCharCode(code));
      }
      i += 4;
      continue;
    }

    const word = /^\\([a-z]+)(-?\d+)? ?/i.exec(source.slice(i));
    if (!word) {
      i++;
      continue;
    }

    const name = word[1]!;
    const parameter = word[2] === undefined ? undefined : Number(word[2]);
    i += word[0].length;

    if (SKIPPED_DESTINATIONS.has(name)) {
      frame.skip = true;
      continue;
    }

    if (name === "uc") {
      frame.ucSkip = parameter ?? 1;
      continue;
    }

    if (name === "u" && parameter !== undefined) {
      // Negative values are the signed-16-bit spelling of a high code point.
      const code = parameter < 0 ? parameter + 65536 : parameter;
      emit(String.fromCharCode(code));
      pendingSkip = frame.ucSkip;
      continue;
    }

    const literal = LITERALS[name];
    if (literal !== undefined) {
      // A paragraph break ends any pending fallback.
      pendingSkip = 0;
      emit(literal);
    }
  }

  return out
    .join("")
    .replace(/\r\n?/g, "\n")
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

/**
 * Windows-1252's upper range, which is where RTF's `\'xx` escapes land.
 *
 * Indexed from 0x80. Undefined entries are unassigned in the code page.
 */
const CP1252: Array<string | undefined> = [
  "€",
  undefined,
  "‚",
  "ƒ",
  "„",
  "…",
  "†",
  "‡",
  "ˆ",
  "‰",
  "Š",
  "‹",
  "Œ",
  undefined,
  "Ž",
  undefined,
  undefined,
  "‘",
  "’",
  "“",
  "”",
  "•",
  "–",
  "—",
  "˜",
  "™",
  "š",
  "›",
  "œ",
  undefined,
  "ž",
  "Ÿ",
];

/** RTF files always begin with this. */
export function looksLikeRtf(text: string): boolean {
  return text.trimStart().startsWith("{\\rtf");
}

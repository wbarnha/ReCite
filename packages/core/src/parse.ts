/**
 * Turning a document into {@link ParsedCitation} objects.
 *
 * The parser runs each pattern from {@link ./patterns.js} over the text,
 * resolves overlaps by priority, then does the three things a bare regex
 * cannot: it groups parallel citations printed for one case, walks backwards
 * to find the case name, and ties short forms (`Id.`, `supra`,
 * `925 F.3d at 1341`) to the full citation they refer to.
 *
 * Offsets always index the exact string passed in. That is what makes fixing
 * possible: a finding says "replace characters 427–437", never "replace this
 * text wherever it appears".
 */

import { resolveCourt, splitParenthetical } from "./courts.js";
import type { CitationKind, Extraction, ParsedCitation, Span } from "./model.js";
import { isShortForm, lookupKey, span } from "./model.js";
import { buildPatterns } from "./patterns.js";
import { canonicalForVariation, findReporter } from "./reporters.js";

interface RawMatch {
  kind: CitationKind;
  start: number;
  end: number;
  groups: Record<string, string | undefined>;
}

/**
 * A citation mid-assembly. `fullSpan` is only knowable once the parallel run
 * and trailing parenthetical have been found, so it is optional until
 * {@link enrich} finishes and every draft becomes a real `ParsedCitation`.
 */
type Draft = Omit<ParsedCitation, "fullSpan"> & { fullSpan?: Span };

/**
 * Scan order matters. Statutes go first because `11 U.S.C. § 362` contains
 * something that looks like the start of a `U.S.` reporter cite; short forms
 * before full cites for the same reason. A later match that overlaps an
 * earlier one is discarded.
 */
const SCAN_ORDER: Array<{
  key: keyof ReturnType<typeof buildPatterns>;
  kind: CitationKind;
}> = [
  { key: "statute", kind: "statute" },
  { key: "database", kind: "database" },
  { key: "neutral", kind: "neutral" },
  { key: "shortForm", kind: "short-form" },
  { key: "caseReporter", kind: "case-reporter" },
  { key: "id", kind: "id" },
  { key: "supra", kind: "supra" },
];

/** Lowercase words that belong inside a party name. */
const NAME_PARTICLES = new Set([
  "of",
  "the",
  "and",
  "de",
  "del",
  "der",
  "van",
  "von",
  "la",
  "le",
  "du",
  "da",
]);

/**
 * Words that introduce a citation rather than belonging to the case name.
 *
 * Bluebook signals (`See`, `Cf.`, `Accord`) and ordinary sentence connectives
 * both capitalise, so walking backwards from ` v. ` happily swallows them:
 * without this list, `See Kaiser Steel Corp. v. W.S. Ranch Co.` is reported as
 * a case named "See Kaiser Steel Corp."
 */
const CITATION_SIGNALS = new Set([
  "see",
  "accord",
  "cf",
  "compare",
  "contra",
  "but",
  "also",
  "citing",
  "quoting",
  "following",
  "eg",
  "ie",
  "in",
  "and",
  "under",
  "lastly",
  "similarly",
  "here",
  "thus",
  "therefore",
  "however",
  "moreover",
  "additionally",
  "furthermore",
  "finally",
  "indeed",
  "instead",
  "rather",
  "while",
  "although",
  "because",
  "since",
  "when",
  "where",
  "with",
  "from",
  "by",
  "at",
  "as",
  "to",
  "for",
  "on",
  "of",
  "generally",
  "accordingly",
]);

/**
 * Abbreviations that end in a period without ending a sentence. Without this
 * list, walking backwards from `Kaiser Steel Corp. v. W.S. Ranch Co.` would
 * stop at `Corp.` and report the case name as `Steel Corp.`
 */
const NAME_ABBREVIATIONS = new Set([
  "co.",
  "corp.",
  "inc.",
  "ltd.",
  "llc.",
  "l.l.c.",
  "llp.",
  "n.a.",
  "p.c.",
  "ass'n.",
  "assn.",
  "bros.",
  "co.,",
  "corp.,",
  "inc.,",
  "ltd.,",
  "no.",
  "dep't.",
  "dept.",
  "univ.",
  "st.",
  "mt.",
  "ry.",
  "r.r.",
  "mfg.",
  "sec.",
]);

export interface ParseOptions {
  /**
   * Treat a hyphen at end of line as a word break and rejoin. PDF extraction
   * splits `371-72` across lines; without this the pin cite is lost.
   */
  readonly rejoinHyphens?: boolean;
}

/** Find every citation in `text`. */
export function parse(text: string, options: ParseOptions = {}): Extraction {
  if (!text.trim()) {
    return { text, citations: [], resources: new Map() };
  }

  const patterns = buildPatterns();
  const raw = collectMatches(text, patterns, options);
  const citations = assemble(text, raw, patterns);
  const resources = groupResources(citations);

  return { text, citations, resources };
}

// ---------------------------------------------------------------- scanning --

function collectMatches(
  text: string,
  patterns: ReturnType<typeof buildPatterns>,
  _options: ParseOptions,
): RawMatch[] {
  const found: RawMatch[] = [];

  for (const { key, kind } of SCAN_ORDER) {
    const pattern = patterns[key];
    if (!(pattern instanceof RegExp)) continue;

    pattern.lastIndex = 0;
    let match: RegExpExecArray | null;
    while ((match = pattern.exec(text)) !== null) {
      // A zero-length match would spin forever.
      if (match[0].length === 0) {
        pattern.lastIndex++;
        continue;
      }

      const start = match.index;
      const end = start + match[0].length;

      const candidate: RawMatch = {
        kind,
        start,
        end,
        groups: { ...(match.groups ?? {}) },
      };

      if (!found.some((existing) => overlaps(existing, candidate))) {
        found.push(candidate);
      }
    }
  }

  return found.sort((a, b) => a.start - b.start || a.end - b.end);
}

function overlaps(a: RawMatch, b: RawMatch): boolean {
  return a.start < b.end && b.start < a.end;
}

// ---------------------------------------------------------------- assembly --

function assemble(
  text: string,
  raw: RawMatch[],
  patterns: ReturnType<typeof buildPatterns>,
): ParsedCitation[] {
  const citations: Draft[] = [];

  for (let i = 0; i < raw.length; i++) {
    const entry = raw[i];
    if (!entry) continue;

    const index = citations.length;
    const base = {
      index,
      kind: entry.kind,
      text: text.slice(entry.start, entry.end),
      span: span(entry.start, entry.end),
    };

    // Where the trailing material for this citation may run to: the next
    // citation, or the end of the document.
    const boundary = raw[i + 1]?.start ?? text.length;

    switch (entry.kind) {
      case "case-reporter":
      case "database":
      case "neutral":
      case "statute":
        citations.push({ ...base, ...fullCitationFields(entry) });
        break;
      case "short-form":
        citations.push({
          ...base,
          fullSpan: base.span,
          volume: entry.groups.volume,
          reporter: entry.groups.reporter?.trim(),
          reporterCanonical: canonicalise(entry.groups.reporter),
          pinCite: entry.groups.pin,
        });
        break;
      case "id":
        citations.push({ ...base, fullSpan: base.span, pinCite: entry.groups.pin });
        break;
      case "supra":
        citations.push({
          ...base,
          fullSpan: base.span,
          caseName: antecedentBefore(text, entry.start),
        });
        break;
    }

    void boundary;
    void patterns;
  }

  // Grouping needs every citation in place first, because a parallel citation
  // is defined by what sits between it and its neighbour.
  return enrich(text, citations, patterns);
}

function fullCitationFields(entry: RawMatch): Partial<ParsedCitation> {
  switch (entry.kind) {
    case "case-reporter":
      return {
        volume: entry.groups.volume,
        reporter: entry.groups.reporter?.trim(),
        reporterCanonical: canonicalise(entry.groups.reporter),
        page: entry.groups.page,
      };
    case "database":
      return {
        year: entry.groups.year ? Number(entry.groups.year) : undefined,
        database: entry.groups.db?.replace(/\s+/g, " ").trim(),
        databaseNumber: entry.groups.num,
      };
    case "neutral":
      return {
        year: entry.groups.year ? Number(entry.groups.year) : undefined,
        neutralBody: [
          entry.groups.juris,
          entry.groups.div ? `(${entry.groups.div})` : undefined,
          entry.groups.num,
        ]
          .filter(Boolean)
          .join(" "),
      };
    case "statute":
      return {
        volume: entry.groups.title,
        reporter: entry.groups.code?.replace(/\s+/g, ""),
        page: entry.groups.section,
      };
    default:
      return {};
  }
}

/** Resolve a written reporter abbreviation to its canonical spelling. */
function canonicalise(written: string | undefined): string | undefined {
  if (!written) return undefined;
  const cleaned = written.trim();
  return findReporter(cleaned)?.abbrev ?? canonicalForVariation(cleaned);
}

/**
 * Attach pin cites, parallel citations, parentheticals and case names.
 *
 * A "group" is one or more reporter citations printed for the same case:
 * `391 U.S. 593, 598, 88 S. Ct. 1753, 20 L.Ed.2d 835 (1968)` is one group of
 * three. The court and year in the parenthetical belong to all of them, and
 * only the first carries the case name.
 */
function enrich(
  text: string,
  citations: Draft[],
  patterns: ReturnType<typeof buildPatterns>,
): ParsedCitation[] {
  const out: Draft[] = citations.map((c) => ({ ...c }));

  for (let i = 0; i < out.length; i++) {
    const first = out[i];
    if (!first || first.kind !== "case-reporter") continue;

    // Collect the parallel run starting here.
    const members = [i];
    let cursor = i;
    while (cursor + 1 < out.length) {
      const current = out[cursor];
      const next = out[cursor + 1];
      if (!current || !next || next.kind !== "case-reporter") break;

      const between = text.slice(current.span.end, next.span.start);
      const pin = patterns.pinCite.exec(between);
      if (pin?.groups?.pin) {
        // `, 598, ` — a pin cite for `current`, then another citation.
        out[cursor] = { ...current, pinCite: pin.groups.pin.replace(/\s+/g, "") };
      } else if (!patterns.parallelJoin.test(between)) {
        break;
      }
      members.push(cursor + 1);
      cursor++;
    }

    const last = out[cursor];
    if (!last) continue;

    // Trailing pin cite and parenthetical belong to the final member.
    let tail = last.span.end;
    const afterLast = text.slice(tail, Math.min(text.length, tail + 240));
    const trailingPin = patterns.trailingPinCite.exec(afterLast);
    const trailingPinText = trailingPin?.groups?.pin;
    if (trailingPin && trailingPinText) {
      // Whitespace is squeezed out — a range split by a line wrap arrives as
      // `371-\n72` and means the same thing as `371-72`.
      out[cursor] = { ...last, pinCite: trailingPinText.replace(/\s+/g, "") };
      tail += trailingPin[0].length;
    }

    const paren = patterns.parenthetical.exec(text.slice(tail));
    let year: number | undefined;
    let courtText: string | undefined;
    let courtSpan: Span | undefined;
    let groupEnd = tail;

    if (paren?.[1] !== undefined) {
      const body = paren[1];
      const bodyStart = tail + paren[0].indexOf("(") + 1;
      const split = splitParenthetical(body);
      year = split.year;
      if (split.courtText && split.courtOffset !== undefined) {
        courtText = split.courtText;
        courtSpan = span(
          bodyStart + split.courtOffset,
          bodyStart + split.courtOffset + split.courtText.length,
        );
      }
      groupEnd = tail + paren[0].length;
    }

    const courtId = courtText ? resolveCourt(courtText)?.id : undefined;

    // `Id. at 166, 119 S. Ct. 662` — the reporter citation is a parallel of
    // the `Id.`, not a new authority, and has no case name of its own.
    const previous = out[i - 1];
    const continuesId =
      previous?.kind === "id" &&
      patterns.parallelJoin.test(text.slice(previous.span.end, first.span.start));

    const caseName = continuesId
      ? undefined
      : findCaseName(text, first.span.start, previous?.span.end ?? 0);
    const nameStart = caseName ? text.lastIndexOf(caseName, first.span.start) : -1;
    const groupStart = nameStart >= 0 ? nameStart : first.span.start;

    for (let m = 0; m < members.length; m++) {
      const at = members[m];
      if (at === undefined) continue;
      const citation = out[at];
      if (!citation) continue;

      out[at] = {
        ...citation,
        year: year ?? citation.year,
        courtId,
        courtText,
        courtSpan,
        caseName: m === 0 ? caseName : citation.caseName,
        fullSpan: span(m === 0 ? groupStart : citation.span.start, groupEnd),
        parallelOf: m === 0 ? (continuesId ? i - 1 : undefined) : members[0],
      };
    }

    i = cursor;
  }

  // Database and neutral citations carry their own year but still take a
  // court from the parenthetical that follows them.
  for (let i = 0; i < out.length; i++) {
    const citation = out[i];
    if (!citation) continue;
    if (citation.kind !== "database" && citation.kind !== "neutral") continue;

    const paren = patterns.parenthetical.exec(text.slice(citation.span.end));
    if (!paren?.[1]) {
      out[i] = { ...citation, fullSpan: citation.span };
      continue;
    }

    const bodyStart = citation.span.end + paren[0].indexOf("(") + 1;
    const split = splitParenthetical(paren[1]);
    const courtSpan =
      split.courtText && split.courtOffset !== undefined
        ? span(
            bodyStart + split.courtOffset,
            bodyStart + split.courtOffset + split.courtText.length,
          )
        : undefined;

    const caseName = findCaseName(text, citation.span.start, out[i - 1]?.span.end ?? 0);
    const nameStart = caseName ? text.lastIndexOf(caseName, citation.span.start) : -1;

    out[i] = {
      ...citation,
      year: citation.year ?? split.year,
      courtText: split.courtText,
      courtSpan,
      courtId: split.courtText ? resolveCourt(split.courtText)?.id : undefined,
      caseName,
      fullSpan: span(
        nameStart >= 0 ? nameStart : citation.span.start,
        citation.span.end + paren[0].length,
      ),
    };
  }

  // Anything still lacking a full span spans exactly itself.
  return out.map((c): ParsedCitation => ({ ...c, fullSpan: c.fullSpan ?? c.span }));
}

// --------------------------------------------------------------- case names --

/**
 * Walk backwards from a citation to find the case name in front of it.
 *
 * A regex alone cannot do this: `Convention. Miller v. United Airlines` and
 * `Kaiser Steel Corp. v. W.S. Ranch Co.` are the same shape, and only knowing
 * that `Corp.` is an abbreviation while `Convention.` ends a sentence tells
 * them apart. Returns `undefined` rather than guessing when the text in front
 * of the citation is not a case name.
 */
export function findCaseName(
  text: string,
  citationStart: number,
  floor = 0,
): string | undefined {
  // `floor` is where the previous citation ended. Never look past it: the
  // window in front of `821 F.2d 1147` otherwise still contains the ` v. ` of
  // the *preceding* citation, and the two get spliced into one invented name.
  const from = Math.max(floor, citationStart - 240, 0);
  const window = text.slice(from, citationStart);

  // A case name is separated from its citation by a comma.
  if (!/,\s*$/.test(window)) return undefined;
  const body = window.replace(/,\s*$/, "");

  const versus = body.lastIndexOf(" v. ");
  if (versus < 0) return inReName(body);

  const left = body.slice(0, versus);
  const right = body.slice(versus + " v. ".length);

  const plaintiff = walkBackForParty(left);
  if (!plaintiff) return undefined;

  const defendant = right.trim();
  if (!defendant || !/^[A-Z"'(]/.test(defendant)) return undefined;

  return `${plaintiff} v. ${defendant}`;
}

/**
 * `In re Air Crash Disaster Near New Orleans, La.` and friends.
 *
 * Periods are allowed inside the name — it routinely ends in a state or
 * corporate abbreviation — so the pattern is bounded by the `$` anchor and by
 * the punctuation that cannot appear in a case name rather than by the period.
 */
function inReName(body: string): string | undefined {
  const match =
    /((?:In\s+re|In\s+the\s+Matter\s+of|Ex\s+parte|Estate\s+of)\s+[A-Z][^;:()]{1,120}?)$/.exec(
      body,
    );
  return match?.[1]?.trim();
}

/** Collect the words immediately left of ` v. ` that belong to the party name. */
function walkBackForParty(left: string): string | undefined {
  const words = left.split(/\s+/).filter(Boolean);
  const taken: string[] = [];

  for (let i = words.length - 1; i >= 0; i--) {
    const word = words[i];
    if (!word) break;

    const previous = words[i - 1];
    const isParticle = NAME_PARTICLES.has(bareWord(word));
    // A party name may open with a quotation mark or a parenthesis.
    const startsName = /^["“'(]?[A-Z]/.test(word);

    if (!startsName && !isParticle) break;

    // A preceding word that ends a sentence bounds the name. `Corp.` and
    // single initials such as `W.S.` do not end sentences.
    if (previous && endsSentence(previous)) {
      taken.unshift(word);
      break;
    }

    taken.unshift(word);
  }

  // Drop the signal or connective that introduced the citation, and any
  // particle left stranded by it ("in the case of Varghese" -> "Varghese").
  while (
    taken.length > 1 &&
    (CITATION_SIGNALS.has(bareWord(taken[0]!)) ||
      NAME_PARTICLES.has(bareWord(taken[0]!)))
  ) {
    taken.shift();
  }
  if (taken.length === 1 && CITATION_SIGNALS.has(bareWord(taken[0]!))) return undefined;
  if (!taken.length) return undefined;

  const name = taken
    .join(" ")
    .replace(/^["“']+/, "")
    .trim();
  return /^[A-Z(]/.test(name) ? name : undefined;
}

/** A word reduced to its letters, for comparison against the word lists. */
function bareWord(word: string): string {
  return word.toLowerCase().replace(/[^a-z]/g, "");
}

/** How far back to look for the name in front of a `supra`. */
const ANTECEDENT_WINDOW = 80;

/**
 * The case name immediately before a `supra`.
 *
 * Done by walking a short, fixed window rather than by regex. The regex form
 * of this — an optional run of capitalised words before the literal — is
 * quadratic, because every failed position backtracks through the whole run.
 * A bounded backwards walk is linear in the document and cannot be made to
 * blow up by any input.
 */
export function antecedentBefore(text: string, offset: number): string | undefined {
  const window = text.slice(Math.max(0, offset - ANTECEDENT_WINDOW), offset);

  // `Ghost Corp., supra` and `Ghost Corp. supra` both occur.
  const body = window.replace(/[\s,]+$/, "");
  if (!body) return undefined;

  const words = body.split(/\s+/).filter(Boolean);
  const taken: string[] = [];

  // Bounded: a case name short form is a handful of words at most.
  for (let i = words.length - 1; i >= 0 && taken.length < 8; i--) {
    const word = words[i];
    if (!word || !/^["“'(]?[A-Z]/.test(word)) break;
    taken.unshift(word);
  }

  while (taken.length && CITATION_SIGNALS.has(bareWord(taken[0]!))) taken.shift();
  if (!taken.length) return undefined;

  return (
    taken
      .join(" ")
      .replace(/^["“']+/, "")
      .replace(/,$/, "")
      .trim() || undefined
  );
}

function endsSentence(word: string): boolean {
  if (!word.endsWith(".")) return false;
  if (NAME_ABBREVIATIONS.has(word.toLowerCase())) return false;
  // Initials such as `W.S.` or `J.` are not sentence ends.
  if (/^(?:[A-Z]\.){1,4}$/.test(word)) return false;
  return true;
}

// ------------------------------------------------------------- short forms --

/**
 * Tie short forms to the full citation they mean.
 *
 * `Id.` refers to whatever was cited immediately before it; `925 F.3d at 1341`
 * to the earlier citation in the same volume; `Varghese, supra` to the earlier
 * case whose name contains that word. A short form that resolves to nothing
 * keeps `resourceKey` undefined, which is what rule ST001 reports.
 */
function groupResources(citations: ParsedCitation[]): Map<string, readonly number[]> {
  const resources = new Map<string, number[]>();
  const resolved: ParsedCitation[] = [];

  /**
   * The key of the authority each citation belongs to.
   *
   * A parallel citation is not an authority of its own: `88 S. Ct. 1753` is
   * another way of printing `391 U.S. 593`. Following `parallelOf` back to the
   * lead is what makes a following `Id.` refer to the case rather than to
   * whichever reporter happened to be printed last.
   */
  const authorityKey = new Map<number, string>();
  for (const citation of citations) {
    if (isShortForm(citation)) continue;
    const lead =
      citation.parallelOf !== undefined
        ? authorityKey.get(citation.parallelOf)
        : lookupKey(citation);
    if (lead) authorityKey.set(citation.index, lead);
  }

  let lastKey: string | undefined;

  for (const citation of citations) {
    let key: string | undefined;

    if (!isShortForm(citation)) {
      key = authorityKey.get(citation.index);
      // Only a lead citation moves `Id.` on; a parallel is the same authority.
      if (key && citation.parallelOf === undefined) lastKey = key;
    } else if (citation.kind === "id") {
      key = lastKey;
    } else if (citation.kind === "short-form") {
      key = findByVolume(resolved, citation);
      if (key) lastKey = key;
    } else if (citation.kind === "supra") {
      key = findByName(resolved, citation.caseName);
      if (key) lastKey = key;
    }

    const stored: ParsedCitation = { ...citation, resourceKey: key };
    resolved.push(stored);

    if (key) {
      const bucket = resources.get(key) ?? [];
      bucket.push(citation.index);
      resources.set(key, bucket);
    }
  }

  // `citations` is the array the caller holds; write the resolved keys back.
  for (let i = 0; i < citations.length; i++) {
    const updated = resolved[i];
    if (updated) citations[i] = updated;
  }

  return resources;
}

function findByVolume(
  earlier: readonly ParsedCitation[],
  short: ParsedCitation,
): string | undefined {
  for (let i = earlier.length - 1; i >= 0; i--) {
    const candidate = earlier[i];
    if (!candidate || candidate.kind !== "case-reporter") continue;
    if (
      candidate.volume === short.volume &&
      candidate.reporterCanonical === short.reporterCanonical
    ) {
      // `resourceKey` already points at the lead of any parallel group.
      return candidate.resourceKey ?? lookupKey(candidate);
    }
  }
  return undefined;
}

function findByName(
  earlier: readonly ParsedCitation[],
  name: string | undefined,
): string | undefined {
  if (!name) return undefined;
  const needle = name.toLowerCase();

  for (let i = earlier.length - 1; i >= 0; i--) {
    const candidate = earlier[i];
    if (!candidate?.caseName) continue;
    const haystack = candidate.caseName.toLowerCase();
    if (haystack.includes(needle) || needle.includes(haystack.split(" v. ")[0] ?? " ")) {
      return candidate.resourceKey ?? lookupKey(candidate);
    }
  }
  return undefined;
}

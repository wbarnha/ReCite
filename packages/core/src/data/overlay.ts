/**
 * What ReCite knows about reporters that upstream does not record.
 *
 * `reporters-db` is a catalogue: names, abbreviations, date spans, and the
 * misspellings people write. It does not say which reporters publish only the
 * Supreme Court, or which carry dispositions that may not be cited as
 * authority — both of which ReCite has rules about.
 *
 * So those live here, by hand, and are applied on top of the vendored table.
 * Two properties make that safe:
 *
 * 1. **An annotation for an abbreviation upstream no longer has is an error**,
 *    not a silent no-op. If a future sync renamed `U.S.` the `scotusOnly` flag
 *    would quietly stop applying and `CT002` would stop catching a circuit
 *    court cited in the Supreme Court's reporter — a rule that fails open and
 *    says nothing. `assertOverlayApplies` turns that into a failing test.
 * 2. **Nothing here changes a date span.** Dates come from upstream, full
 *    stop. If a date is wrong, the fix belongs upstream where everyone
 *    benefits, and carrying a local override would mean quietly disagreeing
 *    with the source we cite.
 */

/** Reporters that publish only the Supreme Court of the United States. */
export const SCOTUS_ONLY: readonly string[] = [
  "U.S.",
  "S. Ct.",
  "L. Ed.",
  "L. Ed. 2d",
  // The nominative reporters: named for the Reporter of Decisions, and cited
  // for early Supreme Court cases before the numbered U.S. series took over.
  "Dall.",
  "Cranch",
  "Wheat.",
  "Pet.",
  "How.",
  "Black",
  "Wall.",
];

/**
 * Reporters carrying dispositions that are not precedential.
 *
 * A table of unpublished dispositions. Citing one as authority is a problem in
 * most courts, and in some it is forbidden outright — which is `AU001`.
 */
export const NON_PRECEDENTIAL: readonly string[] = [
  // Canonical abbreviations only. `Fed. Appx.` and `F. Appx.` were listed here
  // and matched nothing: upstream carries them as *variations* of `F. App'x`,
  // not as editions, so the annotation applied to no reporter at all. It made
  // no visible difference — `findReporter` squashes punctuation, so those
  // spellings already resolve to the canonical entry — which is exactly why it
  // needed a test to find.
  "F. App'x",
  "U.S. App. LEXIS",
];

export interface Annotation {
  readonly scotusOnly?: true;
  readonly nonPrecedential?: true;
}

/** Abbreviation to annotation. */
export const ANNOTATIONS: ReadonlyMap<string, Annotation> = new Map<string, Annotation>(
  [
    ...SCOTUS_ONLY.map((abbrev) => [abbrev, { scotusOnly: true }] as const),
    ...NON_PRECEDENTIAL.map((abbrev) => [abbrev, { nonPrecedential: true }] as const),
  ],
);

/**
 * Misspellings ReCite recognises that upstream does not.
 *
 * Upstream's `variations` are excellent and there are 2,250 of them, but they
 * are drawn from what appears in real opinions. These are ones that turn up in
 * drafting — older or looser forms a writer reaches for from memory — and each
 * is here because a rule depends on it. `"Fed. Rep." → "F."` is the worked
 * example in `RP001`.
 *
 * Merged over the upstream map, so a collision resolves in favour of the
 * deliberate local choice.
 */
export const LOCAL_VARIATIONS: Readonly<Record<string, string>> = {
  "Fed. Rep.": "F.",
  "Fed. Rept.": "F.",
  "Fed. App'x": "F. App'x",
  "Fed. Appx.": "F. App'x",
  "F. Supp.2d": "F. Supp. 2d",
  "Sup. Ct.": "S. Ct.",
  "U.S. Rep.": "U.S.",
  "U.S.R.": "U.S.",
  "Lawyers Ed.": "L. Ed.",
  "L.Ed.2d.": "L. Ed. 2d",
  "Atl.": "A.",
  "Pac.": "P.",
  "N.E. Rep.": "N.E.",
  "Cal. Reptr.": "Cal. Rptr.",
  "Cal. Rprt.": "Cal. Rptr.",
};

/**
 * Every annotated abbreviation that is not in the given table.
 *
 * Empty is the only acceptable answer. A non-empty result means a sync moved
 * the ground under an annotation and a rule has silently stopped working —
 * see the note at the top of this file.
 */
export function unmatchedAnnotations(known: ReadonlySet<string>): string[] {
  return [...ANNOTATIONS.keys()].filter((abbrev) => !known.has(abbrev));
}

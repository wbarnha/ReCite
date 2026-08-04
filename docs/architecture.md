# Architecture

## The pipeline

```
document ─▶ extract ─▶ [verify] ─▶ rules ─▶ diagnostics ─▶ [apply fixes]
            (core)     (verify)   (rules)                    (core.text)
```

Five packages, each with one job:

| Package | Job | Depends on |
| --- | --- | --- |
| `recite-core` | model, extraction, reference data, text patching | eyecite, reporters-db, courts-db |
| `recite-rules` | decides what is wrong | `recite-core` |
| `recite-verify` | talks to CourtListener | `recite-core`, httpx |
| `recite-fix` | orchestrates check and fix | core, rules, verify |
| `recite-cli` | the `recite` command | all of the above |

## Why five packages

The dependency graph is the design. `recite-rules` depends only on
`recite-core`, so a rule *cannot* make a network request or read a file — not
by convention, but because nothing in scope can do those things. That matters
for a linter whose output people act on: a rule is a pure function of the
document plus whatever data was handed to it.

The awkward part is that some rules (the `VF` family) do need CourtListener
results. Rather than have `recite-rules` import `recite-verify`, the *shape* of
a verification result — `CitationVerification`, `VerifiedCluster` — lives in
`recite-core`. `recite-verify` produces those objects, `recite-rules` consumes
them, and neither knows the other exists.

`recite-cli` is separate so that using ReCite as a library does not drag in
typer and rich.

## Design decisions worth knowing

### Spans, not strings

Every finding carries a `Span` into the exact document the caller passed in.
That is what makes fixing possible at all — a rule says "replace characters
427–437 with `550 U.S. 544`" rather than "replace `550 US 544` everywhere",
which would corrupt any document citing the same volume twice.

It also means extraction does **not** clean the text by default. eyecite ships
`clean_text` helpers that strip HTML and squeeze whitespace, and they improve
recall — but they shift every offset. Cleaning is available (`extract(text,
clean=["html"])`) and, when used, `Extraction.text` becomes the document the
spans refer to.

### Corrections are applied back-to-front, and may be refused

Rules run independently, so two of them can want to rewrite the same citation.
For `999 F. 3d 1 (2d Cir. 1950)`, `RP001` wants `999 F.3d 1` and `DT001` wants
`999 F.2d 1`. Applying both would produce garbage.

`apply_corrections` sorts by position, accepts the first correction for any
region, and *reports* the rest on `FixResult.skipped` rather than dropping
them. Edits are then applied in reverse document order so earlier offsets stay
valid. Deciding in forward order makes the outcome independent of which rule
happened to run first.

### Safe versus unsafe

`FixSafety.SAFE` means the authority being cited does not change — only how it
is spelled. `123 F. 3d 456` → `123 F.3d 456` qualifies. Everything that changes
*which case, court or year* is `UNSAFE` and requires `--unsafe`.

The `VF004` year-mismatch rule deliberately offers no fix at all, even though
the correct year is known. A year that disagrees with the database is usually a
symptom of something larger — the wrong volume, or two cases conflated — and
rewriting it would make the citation *look* verified while leaving the real
error untouched.

### Rules report; they do not guess

A rule attaches a correction only when it can name the right answer. `DT001`
suggests `F.2d` for a 1950 citation because exactly one edition of that series
covers 1950; when several do, it reports the problem and stops.

## Working around upstream

### eyecite's `full_span` and year metadata

**eyecite 2.7.x** can begin a citation's `full_span` *inside the previous
citation*. Given:

```
A v. B, 1 U.S. 1 (1801). C v. D, 2 U.S. 2 (1802).
```

the second citation's `full_span` starts at `1 U.S. 1`, and because
`metadata.year` is derived from that span it reports **1801**. Every date rule
would then be checking the wrong year — silently, and in the direction of false
accusations.

`recite.core.extract` therefore does not trust `metadata.year`. The year is
read from the citation's own trailing parenthetical — the text between
`span.end` and `full_span.end`, which is unaffected by the bug — and
`full_span.start` is clamped so it can never precede the previous citation.
eyecite's value is used only when there is no parenthetical to read.
`TestYearAttribution` in `packages/recite-core/tests/test_extract.py` pins this.

The same tail is where `court_text` comes from, which is what makes rewriting
`(Southern District of New York 1990)` possible: eyecite hands back a resolved
`courts-db` id, but to edit the parenthetical you need the original characters
and their offsets.

### courts-db resolving to the wrong court

`find_court("S.D. New York")` answers `nysb` — the *bankruptcy* court for that
district. Left alone, `CT001` would rewrite an ordinary district citation into
a bankruptcy one, which is a far worse error than the formatting problem it set
out to fix.

`resolve_court` therefore takes a `bankruptcy` argument, and `CT001` passes
`False` unless the text itself says "Bankr.". The ambiguous cases then resolve
to nothing, and no rename happens — which is the right outcome. No rename beats
the wrong rename.

### reporters-db spelling

eyecite's reporter patterns treat internal whitespace as optional, so it reports
`"Fed. Rep."` for text that reporters-db indexes under `"Fed.Rep."`. Variation
lookups try both spellings.

Separately, "is this a different abbreviation?" and "does this differ only by
spacing?" are genuinely different questions, and only the second should be a
mere style note. `differs_only_cosmetically` answers it by reducing both
strings to their alphanumerics: `U. S.`, `US` and `U.S.` all become `us`
(cosmetic), while `Fed. Rep.` becomes `fedrep` against `F.`'s `f`
(substantive).

## Being a good API citizen

The CourtListener endpoint is free, shared and rate limited, so `recite-verify`:

- consults its SQLite cache first, and makes **no request at all** when every
  citation is already known;
- chunks requests to stay under the server's 250-citations-per-request cap,
  cutting at citation boundaries so case names stay intact;
- never caches a `429`, which means the citation was never examined — caching
  that would make the next run believe a non-answer;
- refuses to construct a client without a token rather than firing off an
  anonymous request that will be throttled immediately.

Results are matched back onto locally-found citations by character overlap,
falling back to the canonical citation string. CourtListener runs its own copy
of eyecite, possibly a different version, so the two extractions can disagree;
an unmatched result is dropped rather than paired with the wrong citation.

## Testing

No test reaches the network. The client is exercised against a `respx`-mocked
transport; the verifier against an in-process fake; anything that would make a
real request is marked `network` and deselected by `make test` and CI.

`current_year` is injected into `RuleContext` so that "is this year in the
future?" does not become a test that fails in January.

CI also runs `recite check examples/brief.txt` and asserts it **fails** — the
example brief is deliberately full of broken citations, so a clean exit would
mean the linter had stopped working.

# Rule reference

Run `recite rules` for this list at the version you have installed, or
`recite rules DT001` to explain one.

Severity drives the exit code: **only `error` makes `recite check` exit 1.**
Warnings and notes are reported and do not fail a build.

Fixes are marked **safe** (applied by `recite fix`) or **unsafe** (held back
behind `--unsafe`). Safe means the authority being cited does not change — only
how it is spelled.

---

## RP — reporter abbreviation

### `RP001` reporter-format · note / warning · safe fix

The reporter is not written in its standard form.

Reported as a **note** when the difference is only spacing or punctuation
(`123 F. 3d 456`, `550 US 544`, `410 U. S. 113`), and as a **warning** when a
genuinely different abbreviation was used (`12 Fed. Rep. 34` for `12 F. 34`).

The fix is eyecite's own canonicalisation, so it is always safe.

### `RP002` ambiguous-reporter · warning · fix when the year settles it

The abbreviation belongs to more than one reporter series. If a year is present
and only one candidate series was being published then, that series is
suggested as an unsafe fix; otherwise the rule reports and stops.

### `RP003` unrecognized-reporter · error · unsafe fix

Text shaped like a citation whose reporter is in no reporter database —
`12 Cal. Rprt. 3d 45`, where `Cal. Rptr. 3d` was meant.

This rule exists because eyecite returns *nothing* for an unknown reporter, so
without it a mistyped reporter is invisible: the citation simply vanishes from
the report instead of being flagged.

To keep false positives down it only fires when the reporter token is unknown
to reporters-db *and* close to a real abbreviation. A reporter that exists but
which eyecite did not claim — usually a citation wrapped across two lines by a
PDF extractor — is deliberately left alone.

---

## DT — dates

### `DT001` year-outside-edition · error · unsafe fix

The decision year falls outside the years that reporter was published.
`999 F.3d 1 (2d Cir. 1950)` cannot be right: F.3d began in 1993.

The most useful offline check in the set, because a reporter series and a date
are enough to prove a citation impossible without looking anything up. When
exactly one edition of the same series covers the cited year, that edition is
offered as a fix.

### `DT002` implausible-year · error / warning · no fix

A year in the future (error), or before 1600 (warning). No fix is offered
because there is no way to know what was meant.

---

## CT — court

### `CT001` court-abbreviation · note · unsafe fix

The court is named in some form other than its Bluebook abbreviation —
`(Southern District of New York 1990)` rather than `(S.D.N.Y. 1990)`.

Only fires when courts-db resolves the text unambiguously. Parentheticals like
`(en banc)` and `(per curiam)` resolve to nothing and are left alone, and
Supreme Court parentheticals are skipped because courts-db spells that court
`SCOTUS`, which is not how a citation reads.

### `CT002` reporter-court-mismatch · error · no fix

The parenthetical names a court that cannot appear in that reporter.
`200 U.S. 1 (9th Cir. 1906)` — the U.S. Reports carry only the Supreme Court.
Usually means two citations were spliced together.

### `CT003` court-did-not-exist · warning · no fix

The court was not sitting in the year cited — created later, or abolished
earlier.

---

## ST — document structure

### `ST001` unresolved-short-form · error · no fix

An `Id.`, `supra`, or short-form citation with no full citation before it to
attach to. The easiest thing to break while editing: move a paragraph and the
`Id.` that opened it now points at nothing.

### `ST002` pin-cite-out-of-range · warning · no fix

The pin cite precedes the page the opinion starts on — `410 U.S. 113, 99`.
Only the lower bound is checkable offline, since where an opinion *ends* is not
in any local database, but transposed digits usually trip this.

For short forms the first page is taken from the full citation they resolve to.

---

## VF — CourtListener verification

These need `recite check --verify` and a `COURTLISTENER_API_TOKEN`. Without
them the rules are inert, not failing.

### `VF001` unknown-authority · error · no fix

The citation is well-formed but matches nothing in CourtListener. **This is the
hallucination check**: an invented citation is typically impeccable in form and
simply does not exist.

Note that CourtListener's coverage, while very broad, is not total — a `VF001`
means "verify this by hand", not "this is definitely fabricated".

### `VF002` ambiguous-authority · warning · no fix

The citation matches several cases. Usually a missing parallel citation, court
or year.

### `VF003` case-name-mismatch · error · no fix

The reporter citation is real, but belongs to a different case than the one
named — a plausible case name bolted onto a real volume and page.

Comparison is by significant-word overlap, not string equality, so
`Bell Atl. Corp. v. Twombly` and `Bell Atlantic Corporation v. Twombly` are
recognised as the same case. Corporate suffixes and `v.` are ignored.

### `VF004` year-mismatch · warning · no fix

The case exists but CourtListener dates it to a different year.

Deliberately offers no fix even though the right year is known: a year that
disagrees with the database is usually a symptom of a larger error, and
rewriting it would make the citation look verified while leaving that error in
place.

---

## Selecting rules

```console
recite check brief.txt --select RP001 --select DT001   # only these
recite check brief.txt --ignore CT001                  # everything but this
```

Both accept ids (`RP001`) and names (`reporter-format`). An unknown identifier
is an error rather than a silent no-op.

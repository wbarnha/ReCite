# Rule reference

Severity is advice about attention, not a verdict: **error** means the citation
is demonstrably wrong or cannot be relied on as written, **warning** means it is
probably wrong or needs a decision, and **info** is style.

Fixes are **safe** (applied by default) or **unsafe** (need an explicit
opt-in). Safe means the authority being cited does not change — only how it is
spelled. Anything that changes which case, court or year is referenced is
unsafe, because a confidently wrong citation is worse than a visibly broken one.

Every example below is drawn from the sample document, which is transcribed
from a real filing. See [testing.md](testing.md) for where it came from.

## Which Bluebook

Some rules depend on which edition you are writing to, and on which half of
the book governs your document. Both are selectable in the app — the two
dropdowns above the editor — and settable on the `Engine`:

```ts
new Engine({ profile: { edition: 21, style: "practitioner" } });
```

### Editions

`20` (2015), `21` (2020) and `22` (2025). The app labels them `20th (2015)`
and so on; the `Engine` takes the bare number.

### Bluepages or Whitepages

The Bluebook is two rule sets printed on differently coloured paper, and they
do not always agree:

| Setting        | The book calls it | Governs                                    |
| -------------- | ----------------- | ------------------------------------------ |
| `practitioner` | **Bluepages**     | Briefs, motions, memoranda — the `B` rules |
| `academic`     | **Whitepages**    | Law review footnotes and scholarly writing |

The internal names say what the setting does; the app shows the Bluepages and
Whitepages names, because that is what a brief-writer looks for.

### What actually changes

| Edition    | Rule set   | Effect                                                               |
| ---------- | ---------- | -------------------------------------------------------------------- |
| 21st, 22nd | Bluepages  | Reporter abbreviations may be closed up: `119 S.Ct. 662` is accepted |
| 20th       | either     | Rule 6.1(a) spacing required: `119 S. Ct. 662`                       |
| any        | Whitepages | Rule 6.1(a) spacing required                                         |

The allowance is the 21st edition's, and it is a Bluepages rule — it applies
to court filings, not to law review footnotes. It is also permission rather
than prescription, so ReCite stops _requiring_ the space rather than
requiring its removal. `RP003` still fires when a document uses both forms:
being allowed to tighten is not being allowed to be inconsistent.

The default is the 21st edition, Bluepages, which is what most people checking
a brief want.

---

## RP — reporter abbreviation

### `RP001` reporter-format · info / warning · safe fix

The reporter is not in its standard form.

An **info** when only the spacing differs (`119 S.Ct. 662` → `119 S. Ct. 662`,
`20 L.Ed.2d 835` → `20 L. Ed. 2d 835`), a **warning** when a substantively
different abbreviation was used (`12 Fed. Rep. 34` → `12 F. 34`). The fix
changes spelling only, so it is always safe.

### `RP002` unknown-reporter · error · unsafe fix

Citation-shaped text naming a reporter in no table — `12 Cal. Rprt. 3d 45`,
where `Cal. Rptr. 3d` was meant.

This rule exists because the parser only matches reporters it knows, so a
mistyped one produces _no citation at all_: without RP002 the error is
invisible rather than reported. It fires only when the token is both unknown
and a near-miss for a real abbreviation, which keeps numbers in ordinary prose
from being read as citations. A reporter the tables know but the parser skipped
— usually a citation wrapped across two lines by a PDF extractor — is left
alone.

### `RP003` inconsistent-reporter-style · warning · no fix

One reporter abbreviated two ways in the same document.

Not a defect in any single citation, which is why the per-citation rules miss
it. But a brief that says both `119 S.Ct. 662` and `119 S. Ct. 662` was
assembled from more than one source, and that is worth knowing before anything
else in it is trusted. Reported once per reporter, not once per citation.

---

## DT — dates

### `DT001` year-outside-reporter-range · error · unsafe fix

The decision year falls outside the years that reporter was published.
`999 F.3d 1 (2d Cir. 1950)` cannot be right: the Federal Reporter's third
series began in 1993.

The strongest check available offline — a reporter series and a date are
together enough to prove a citation impossible, with no database and no
network. When exactly one edition of the same series covers the cited year,
that edition is offered as a fix.

### `DT002` implausible-year · error / warning · no fix

A year in the future (error) or before 1600 (warning). No fix, because there is
no way to know what was meant.

---

## CT — court

### `CT001` court-abbreviation · info · unsafe fix

The court is named in some form other than its standard abbreviation:
`(Southern District of New York 1990)` → `(S.D.N.Y. 1990)`.

Fires only when the written form resolves to exactly one court.

### `CT002` reporter-court-mismatch · error · no fix

The parenthetical names a court that cannot appear in that reporter:
`200 U.S. 1 (9th Cir. 1906)` — the U.S. Reports carry only the Supreme Court.
Usually means two citations were spliced together, which is a common shape for
a fabricated one.

### `CT003` court-did-not-exist · warning · no fix

The court was not sitting in the year cited. The Eleventh Circuit, for
instance, was created in 1981.

### `CT004` ambiguous-court · info · no fix

The abbreviation names more than one court. `App. Div.` is both New York's and
New Jersey's intermediate appellate court; a reader cannot tell which was
meant, and neither can ReCite, so it says so instead of picking one.

### `CT005` redundant-court · info · safe fix

The reporter already says which court decided the case, so rule 10.4(a) leaves
it out of the parenthetical: `526 U.S. 795 (U.S. 1999)` should read
`526 U.S. 795 (1999)`.

The other face of `CT002`. There the parenthetical contradicts a single-court
reporter, which means two citations were spliced together; here it merely
repeats it, and the fix is safe because the authority does not change.

### `CT006` non-standard-court · warning · unsafe fix

The court is a standard abbreviation with a word written out: `(9 Cir. 2007)`
for `(9th Cir. 2007)`, `(S.D. New York 1990)` for `(S.D.N.Y. 1990)`.

Fires only when exactly one court's abbreviation is the same abbreviation
token for token, each one a prefix of its counterpart. Anything vaguer is left
alone: ReCite's court table is a curated subset of the judiciary, so "not in
the table" is not evidence that something is not a court, and a citation
checker that renames a court is worse than one that says nothing. `(N. Dist.
Ind. 2014)` therefore gets no finding — the Northern District of Indiana is not
in the table, so there is nothing to suggest.

---

## ST — document structure

### `ST001` unresolved-short-form · error · no fix

An `Id.`, `supra` or short-form citation with no full citation before it. The
easiest thing to break while editing: move a paragraph and the `Id.` that
opened it now points at nothing.

### `ST003` page-range-format · info · no fix

A page range that repeats digits the Bluebook drops. Rule 3.2(a) keeps the
last two digits of the second number and drops the rest when they repeat the
first: `371-372` should read `371-72`, `1204-1208` should read `1204-08`.
`98-102` is left alone, because nothing in it is repetitious.

### `ST004` reversed-page-range · warning · no fix

A range that ends before it begins — `380-371`. Usually transposed digits.

### `ST002` pin-cite-out-of-range · warning · no fix

The pin cite precedes the page the opinion starts on — `410 U.S. 113, 99`. Only
the lower bound is checkable offline, since where an opinion _ends_ is not in
any local table, but transposed digits usually trip this. Short forms are
checked against the full citation they resolve to.

### `ST005` short-form-parenthetical · warning · no fix

A short form carrying a date: `Griggs, 181 F.3d at 700-01 (1999)`. B10.2 gives
the court and the date once, in the full citation. A year here is usually a
full citation that was edited down by hand and left half-finished.

Only a parenthetical containing the year and nothing else counts. An
explanatory parenthetical that happens to mention a year is B1.3's business,
not this rule's.

### `ST006` section-symbol-count · warning · safe fix

`§` for one section, `§§` for more than one (rule 3.3(b)).
`18 U.S.C. § 1544, 1546` needs the second symbol. The fix rewrites the symbol
alone, so the authority does not change.

### `ST007` section-range-digits · warning · no fix

A span of sections that drops digits: `17 U.S.C. §§ 103-07` should read
`§§ 103-107`.

**Rule 3.3(b) runs the opposite way to rule 3.2(a).** Pages drop repetitious
digits (`371-72`); sections keep all of them (`103-107`). Reversing the two is
the mistake this rule exists for, and `ST003` is its counterpart on the page
side.

No fix: `103-07` could have been abbreviated from `107` or from `1007`, and the
citation itself does not say which. A hyphen inside a rule's name — Rule 10b-5
in `17 C.F.R. § 240.10b-5` — is not a span and is left alone.

---

## AU — weight of authority

These do not say a citation is malformed. They say it may not carry the
authority the sentence around it claims — a different, and often more
consequential, kind of mistake.

### `AU001` non-precedential-disposition · error / warning · no fix

The disposition is not precedent.

Illinois marks Rule 23 orders with a `-U` suffix on the public-domain citation
(`2013 IL App (1st) 111279-U`); those may not be cited as authority at all, so
this is an **error**. The Federal Appendix collects unpublished federal
dispositions, which are citable but not binding — a **warning**.

### `AU002` database-only-citation · warning · no fix

A case cited only by a commercial database number: `2019 WL 4639462`. It
carries no court, no volume and no page, so a reader without that subscription
cannot find it and cannot tell whether it was ever published.

Two things answer the objection and silence the rule: a parallel reporter
citation, and a docket number. The docket number matters because a case
genuinely not yet in the reporters is cited by docket number _and_ database
identifier under rule 10.8.1(a) — `No. 15-2994, 2016 WL 5929824, at *6` is the
correct form, and complaining about it would be complaining that an unreported
case is unreported.

---

## VF — verification against a corpus

These need an authority corpus. Without one they are inert, not failing.

**Read these findings carefully.** A corpus is only as complete as whoever
assembled it. Absence from one is a reason to check a citation by hand — never
proof that a case does not exist, and the messages are worded accordingly.

### `VF001` unverified-authority · warning · no fix

The citation is well-formed but absent from the corpus. This is the check that
can catch a fabricated citation, which is typically impeccable in form. Nothing
else in the rule set can see it.

### `VF002` ambiguous-authority · warning · no fix

The citation matches several authorities and picks out none of them.

### `VF003` case-name-mismatch · error · no fix

The citation is real but belongs to a different case than the one named — a
plausible case name bolted onto a real volume and page. Compared by
significant-word overlap, not string equality, so `Bell Atl. Corp. v. Twombly`
and `Bell Atlantic Corporation v. Twombly` are recognised as the same case.

### `VF004` year-mismatch · warning · no fix

The authority exists but the corpus dates it to a different year.

Deliberately offers no fix even though the right year is known: a year that
disagrees with the record is usually a symptom of a larger error, and rewriting
it would make the citation look verified while leaving that error in place.

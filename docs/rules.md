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

Some rules depend on which edition you are writing to, and on whether you are
writing a brief or an article. Both are selectable in the app and settable on
the `Engine`:

```ts
new Engine({ profile: { edition: 21, style: "practitioner" } });
```

| Edition    | Style             | Effect                                                               |
| ---------- | ----------------- | -------------------------------------------------------------------- |
| 21st, 22nd | court documents   | Reporter abbreviations may be closed up: `119 S.Ct. 662` is accepted |
| 20th       | either            | Rule 6.1(a) spacing required: `119 S. Ct. 662`                       |
| any        | scholarly writing | Rule 6.1(a) spacing required                                         |

The allowance is the 21st edition's, and it is a Bluepages rule — it applies
to court filings, not to law review footnotes. It is also permission rather
than prescription, so ReCite stops _requiring_ the space rather than
requiring its removal. `RP003` still fires when a document uses both forms:
being allowed to tighten is not being allowed to be inconsistent.

The default is the 21st edition for court documents, which is what most people
checking a brief want.

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
cannot find it and cannot tell whether it was ever published. Silent when a
parallel reporter citation appears alongside it.

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

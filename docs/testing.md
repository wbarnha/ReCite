# Testing, and where the fixtures come from

```console
$ pnpm test          # 922 tests
$ pnpm coverage
$ pnpm check         # lint + format + types + tests, exactly what CI runs
$ pnpm test:browser  # the built site in real Chromium (needs `pnpm build:release` first)
```

`pnpm test:browser` is separate because it needs a build and a browser. It is
the only place two claims can actually be checked: that OCR turns a scanned
page into readable citations, and that nothing the app does leaves the origin.
The second is not paranoia — Scribe's CDN fallback URL is still a string in the
bundle, because it is the default in library code we do not control, so the
override has to be **observed** rather than assumed. The test intercepts every
request and fails if one goes off-origin.

Its scanned-PDF fixture is generated, not committed: text is rendered in
Chromium, screenshotted as a JPEG, and wrapped in a hand-written one-page PDF
with no text layer at all. A PDF with a text layer would not exercise OCR,
because the reader would correctly read the text layer instead.

Tests import workspace packages through aliases that point at `src`, not
`dist` — see [`vitest.config.ts`](../vitest.config.ts). A suite that ran
against a stale build could pass while the fix sat uncompiled.

## The fixture corpus

The parser fixtures are transcribed from a real court filing:

> _Mata v. Avianca, Inc._, No. 1:22-cv-01461-PKC (S.D.N.Y.), Document 21 —
> "Affirmation in Opposition", filed 1 March 2023.

A public court record, and an unusually good corpus for this project for two
reasons. First, several of its citations were fabricated, which is the failure
mode ReCite exists to help with. Second — and more useful day to day — the
citations are typed inconsistently enough to exercise nearly every branch of
the parser: the Supreme Court Reporter appears as both `S.Ct.` and `S. Ct.`
within two lines, `L.Ed.2d` runs its components together, one case is cited by
Illinois public-domain number and two by Westlaw number alone.

[`packages/core/test/fixtures/mata-avianca.ts`](../packages/core/test/fixtures/mata-avianca.ts)
holds each citation as it appears, the parse it should produce, and a note on
what makes that shape hard. The fixtures are table-driven, so a failure names
the format that broke rather than a line number.

### Formats covered

| Fixture                               | Format                                                          |
| ------------------------------------- | --------------------------------------------------------------- |
| `us-reports-no-court`                 | `556 U.S. 662 (2009)` — court implied by the reporter           |
| `federal-reporter-third-with-circuit` | `419 F.3d 1058 (9th Cir. 2005)`                                 |
| `neutral-citation-unpublished`        | `2013 IL App (1st) 111279-U` — no volume, no page               |
| `multi-word-reporter`                 | `905 F. Supp. 2d 121` — must beat `F. Supp.` in the alternation |
| `ambiguous-court-abbreviation`        | `(App. Div. 2003)` — two states use it                          |
| `westlaw-with-month-and-day`          | `2019 WL 4639462 (Tex. App. Sept. 25, 2019)`                    |
| `estate-of-case-name`                 | `Estate of Durden v. KLM …`                                     |
| `corporate-suffixes-in-case-name`     | `Varghese v. China Southern Airlines Co., Ltd.`                 |
| `statute-with-subsection`             | `11 U.S.C. § 362(a)`                                            |
| `statute-nested-subsection`           | `11 U.S.C. § 362(a)(1)`                                         |
| `parallel-citations-with-pin`         | `391 U.S. 593, 598, 88 S. Ct. 1753, 20 L.Ed.2d 835 (1968)`      |
| `pin-cite-then-parenthetical`         | `516 F.3d 1237, 1254 (11th Cir. 2008)`                          |
| `unspaced-supreme-court-reporter`     | `119 S.Ct. 662`, behind an opening quote                        |
| `id-with-parallel-cite`               | `Id. at 166, 119 S. Ct. 662`                                    |
| `two-cases-one-sentence`              | two citations joined by `;`, the second an `In re` name         |
| `pin-range-broken-across-lines`       | `371-\n72` — what pasting from the PDF gives you                |
| `bare-short-reference`                | a case named with no citation; nothing should parse             |

### Things the fixtures pin down

Several are there because a plausible implementation gets them wrong:

- **`Id.` resolves to the authority, not the last reporter printed.** After
  `391 U.S. 593, 598, 88 S. Ct. 1753, 20 L.Ed.2d 835`, a following `Id.` means
  the case — so it must resolve to `391 U.S. 593`, not to `20 L. Ed. 2d 835`.
- **A case name must not swallow the citation before it.** In
  `Miller …, 174 F.3d 366 …; In re Air Crash Disaster …, 821 F.2d 1147`, the
  window in front of the second citation still contains Miller's `v.`.
- **`Corp.` does not end a sentence but `Convention.` does.** That distinction
  is the whole of `Kaiser Steel Corp. v. W.S. Ranch Co.` versus
  `Convention. Miller v. United Airlines`.
- **A signal is not part of the name.** `See Kaiser Steel Corp.` is a case
  named `Kaiser Steel Corp.`

## The graded corpus

The Mata filing is a corpus of real citations, and it answers "does the parser
see this?". It cannot answer "is this citation right?", because nothing in it
is marked right or wrong.

The second corpus is:

> _Experiential Legal Writing I — Citations Quiz_, a 1L review handout
> (`SBanQuizReviewBluebookCitations1L.pdf`). Twenty questions across cases,
> statutes and secondary sources, each with the correct citation and the
> Bluebook rule it comes from.

[`packages/core/test/fixtures/bluebook-quiz.ts`](../packages/core/test/fixtures/bluebook-quiz.ts)
holds every graded answer with the quiz's verdict on it, and
[`packages/engine/test/bluebook-quiz.test.ts`](../packages/engine/test/bluebook-quiz.test.ts)
runs the whole engine over each one. Two invariants:

1. **A citation the quiz grades correct produces no findings.** This is the
   stricter half. A checker that flags correct work is worse than one that
   misses errors — the errors were going to be missed anyway, but a false
   positive costs time and, if acted on, breaks a citation that was right.
2. **A citation the quiz grades incorrect either produces the findings the
   fixture names, or carries a written reason why it does not.** Silence is
   allowed; unexplained silence is not.

The quiz text was extracted from the PDF with ReCite's own OCR importer.

### What it found

Two false positives, both on citations the quiz grades **correct**:

- `64 U. Pitt. L. Rev. 639 (2003)` was reported as a misspelled case reporter,
  with an offer to rewrite it to `Pitts L.J.` — an 1850s Pittsburgh reporter.
  Briefs cite law reviews constantly, so this was not a rare shape.
- `No. 15-2994, 2016 WL 5929824, at *6` was reported as a database citation
  missing its reporter. The docket number is exactly how rule 10.8.1(a) says a
  case not yet in the reporters is cited; the complaint amounted to objecting
  that an unreported case is unreported.

And five rules that were missing: `CT005`, `CT006`, `ST005`, `ST006` and
`ST007`. `ST007` is the one worth naming — rule 3.3(b) keeps every digit in a
span of sections while rule 3.2(a) drops them from a span of pages, and
`ST003` had been checking the page half for some time with nothing checking
the other.

### What it does not catch

Eight of the quiz's wrong answers produce no finding, each recorded in the
fixture with the reason. They fall into three groups:

- **Case names.** Party abbreviations (`U.S v. Wilson`), procedural phrases
  (`in re` for `ex rel.`), and which words abbreviate in a textual sentence.
  ReCite checks the citation, not the name in front of it.
- **Prose.** Explanatory parentheticals (`held that` for `holding that`) are a
  grammar question.
- **Reference data.** `58 F.3d 882 (N.D. Ind. 2014)` puts a district court in
  an appellate reporter, but ReCite's court table is a curated subset and does
  not hold the Northern District of Indiana, so there is no court id to
  contradict. Closing this one means more court data, not more rules.

### On the fabricated citations

The suite asserts that `925 F.3d 1339` parses as **well-formed**, and that the
offline rules report nothing about it. That is the point of the test: nothing
about its format is wrong, so format checking alone would pass it. Only the
`VF` family, given a corpus, has anything to say.

The corpus in the fixtures is a handful of records — enough to demonstrate the
mechanism, and explicitly not a legal reference.

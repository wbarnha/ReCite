# Testing, and where the fixtures come from

```console
$ pnpm test          # 1135 tests
$ pnpm coverage
$ pnpm check         # lint + format + types + tests, exactly what CI runs
$ pnpm test:browser  # the built site in real Chromium (needs `pnpm build:release` first)
```

`pnpm test:browser` is separate because it needs a build and a browser. It is
the only place some claims can actually be checked: that OCR turns a scanned
page into readable citations, that nothing the app does leaves the origin
unless a CourtListener token was supplied, and that the document editor reads a
real `contenteditable` the way its model says it does — which is precisely the
sort of thing a fake DOM would agree with and a real one would not.
The second is not paranoia — tesseract.js's CDN fallbacks for its worker, its
WebAssembly core and its language model are all still strings in the bundle,
because they are the defaults in library code we do not control, so the
overrides have to be **observed** rather than assumed. The test intercepts every
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

## Measuring the OCR path

```console
$ pnpm build:release
$ pnpm bench:ocr
```

`tools/bench/ocr.ts` opens a generated scanned PDF in real Chromium and reports
elapsed time next to **citation recall** — how many of the document's citations
survived being read. Both, always. `tools/tessdata` documents choosing an 11 MB
language model over a 2.9 MB one because "a misread digit in a volume number is
a wrong citation that looks right", and every knob in this area trades the same
way, so a configuration that is faster and recovers fewer citations is reported
as a regression rather than an improvement.

The scorer (`tools/bench/accuracy.ts`) compares two strings and knows nothing
about any particular engine. That is deliberate: comparing two engines is what
it was built for, and it is what settled the choice recorded below.

### What the numbers do not say

Two limits, stated because the table looks more conclusive than it is.

- **The fixture is one page.** The worker sweep therefore measures the startup
  cost of spinning up workers with no parallelism available to repay it. It
  says what extra workers cost on a short document and nothing about what they
  earn on a long one. Changing Scribe's `workerN` default needs a multi-page
  fixture first, and the default is unchanged.
- **The timings are loopback.** The engine chunk and the 11 MB model arrive in
  under 100ms from a local server, which makes the warmup look pointless; on a
  real connection those two downloads are most of the wait.

### How the OCR stack was chosen

ReCite used to read PDFs with `scribe.js-ocr`. It is **AGPL-3.0**, and it was
compiled into the bundle published from GitHub Pages, which the BSD-2-Clause
this project is licensed under does not cover. So a replacement was built on
`pdfjs-dist` and `tesseract.js` — both **Apache-2.0** — and the two were scored
against each other on one fixture with everything else held still.

The first measurement said do not switch:

| engine                    | elapsed | similarity | citation recall |
| ------------------------- | ------- | ---------- | --------------- |
| `scribe` (AGPL-3.0)       | 4.9s    | 99.6%      | **100%**        |
| `permissive` (Apache-2.0) | 2.8s    | 99.2%      | **80%**         |

Faster, and it lost the statute. `18 U.S.C. §§ 1544, 1546` came back as
`§8§ 1544` — a digit invented between the two section symbols. Worse than a
loss, in fact: the parser reads `§8§ 1544, 1546` as a citation to **section
8**, an authority the document never cited, reported with no warning. A
citation checker that invents citations is the exact failure this project
exists to catch.

Two hypotheses were tested and neither held. Running Tesseract's legacy and
LSTM engines together (OEM 2) rather than the LSTM-only default changed
nothing. Raising the page render from 300 to 450 DPI made it _worse_ — both
symbols became `88`, giving `18 U.S.C. 88 1544`, which reads as plausible text
rather than as damage.

What fixed it was domain knowledge rather than tuning.
`apps/web/src/import/ocr-repair.ts` puts the symbols back, and it can do so
safely because it fires only between a code abbreviation and a section number,
and only when a real `§` survived the recognition — which proves the author
typed one, so a digit inside that run is noise rather than content. It
deliberately declines the `88` case, where no `§` survived and there is no way
to tell it from a genuine reference to section 88.

With the repair, the permissive stack matches:

| engine                | elapsed | similarity | citation recall |
| --------------------- | ------- | ---------- | --------------- |
| `permissive` + repair | 3.4s    | **99.6%**  | **100%**        |

So `scribe.js-ocr` was removed rather than merely deselected — an AGPL
dependency that is still bundled is still distributed, whether or not it is
reachable — and the repository is BSD-2-Clause in fact and not only in the
`LICENSE` file.

### What is not tunable

Render resolution. Scribe hardcodes it — `js/extractPDFText.js:33` computes
`300 * Math.min(width, 3500) / width` and `extractText` exposes no way to
change it. Downscaling page images before recognition would mean bypassing
Scribe's PDF handling entirely, which would also lose the text-layer path, so
it is not implemented rather than implemented badly.

## Which browsers, and what a green tick means

ReCite runs entirely in the browser, so "does it work" is a question about
engines rather than about this repository. For a long time the answer came from
Chromium alone — and Chromium was green while an iPhone user was getting
`undefined is not a function` opening a PDF. That message is JavaScriptCore's
way of saying something was iterated that has no iterator. A Chromium-only
suite cannot see it, because Chromium is not the engine that broke.

`tools/test/platforms.test.ts` is the answer to that, and `.github/workflows/platforms.yml`
runs it once per platform. Every job drives a **real engine**:

| Platform           | Engine                     | Relationship to what users run  |
| ------------------ | -------------------------- | ------------------------------- |
| `desktop-chromium` | Blink, V8                  | the engine Chrome and Edge ship |
| `desktop-firefox`  | Gecko, SpiderMonkey        | the engine Firefox ships        |
| `desktop-webkit`   | WebKit, JavaScriptCore     | WebKit **trunk** — see below    |
| `blink-phone`      | Blink, V8, Pixel 7 metrics | Android Chrome **is** Blink     |
| `webkit-phone`     | WebKit, JSC, iPhone 15     | **not** Mobile Safari           |

**No platform here is named for an operating system**, and that is the point.
Playwright builds WebKit from the upstream `main` branch, so its JavaScriptCore
is the same C++ sources Apple compiles — which is exactly why it can reproduce a
`for…of` over a non-iterable, the fault the iPhone report described.

But **trunk runs ahead of the Safari on anyone's phone.** So this suite cannot
see a bug that shipping Safari still has and trunk has already fixed, and that
is the majority of real iOS bug reports. Nor can it see anything belonging to
iOS rather than to WebKit: the file picker, touch-only interaction, or the
memory ceiling that kills the content process on a real handset — which, for an
app that loads `pdfjs-dist` and `tesseract.js`, is a live risk.

The phone rows add a device descriptor — viewport, pixel ratio, touch and user
agent — and nothing more. `blink-phone` is close to a handset because Android
Chrome genuinely is Blink. `webkit-phone` is the right engine family at the
right size and **is not an iPhone**.

A green tick means "the engine family an iPhone runs, at an iPhone's size,
slightly ahead of the version an iPhone has". That is a large improvement on
"tested on Chromium" and it is not a device. Only a real handset, or Apple's own
Safari driven by `safaridriver` on a macOS runner, can make the stronger claim.

### One build, every engine

The workflow builds once and every platform job downloads the same artefact, so
a failure is a difference between engines rather than between builds — which is
the only thing the matrix is trying to measure.

### A missing engine is never a pass

The trap in a matrix like this is that an engine which fails to install reports
a green tick for a platform nothing ran on. So:

- **Locally**, a missing engine **skips**, visibly. A contributor with only
  Chromium gets `14 passed | 21 skipped` rather than a fake all-clear.
- **In CI**, `RECITE_REQUIRE_PLATFORMS=1` turns a missing engine into a
  **failure**, because a job whose whole purpose is to run WebKit has done
  nothing of value if WebKit is absent.

Run one platform locally with `RECITE_PLATFORMS=webkit-phone pnpm test:platforms`,
after `pnpm exec playwright install webkit`.

### The browser Apple actually ships

Everything above drives Playwright, and Playwright cannot drive branded Safari —
it relies on patches, so it bundles WebKit from upstream `main`. `tools/test/safari.test.ts`
closes that gap by talking to `/usr/bin/safaridriver`, the W3C WebDriver server
built into macOS, over plain HTTP with `fetch`. No Selenium, no WebdriverIO, no
new dependency: `tools/test/helpers/webdriver.ts` is about a hundred lines.

GitHub's macOS images already run `sudo safaridriver --enable` at build time, so
the CI job is one background process.

**What it proves.** Desktop Safari 26.x and Mobile Safari on iOS 26.x are the
same WebKit release train and the same JavaScriptCore, so a _pure JavaScript_
engine bug on an iPhone reproduces here. That is a materially stronger claim
than anything the `webkit-phone` row can make, because it is the shipping
version rather than trunk.

**What it does not.** It is macOS. It cannot see the iOS file picker,
touch-only interaction, or the memory ceiling that kills the content process on
a real handset. It only ever tests the Safari on the runner, so an older iPhone
stays out of reach. Only a device cloud goes further.

Two constraints shape how it is written, and both are easy to get wrong:

- **WebDriver has no page-error event.** Unlike Playwright there is no
  `pageerror`, so an uncaught exception is invisible and shows up only as a
  later assertion timing out. `serveSite({ collectErrors: true })` serves a
  small script that records `error` and `unhandledrejection` into
  `window.__reciteErrors`, and the suite reads it back after each step.
- **That collector cannot be inline.** The app ships
  `script-src 'self' 'wasm-unsafe-eval'` with no `'unsafe-inline'`, so an
  inline collector would be refused by the very policy the app is proud of —
  and the suite would report a clean page while the browser blocked its
  instrument. It is served as a same-origin file, and only when asked for, so
  the suites that assert on subresource integrity still see the published
  article untouched.

Locally:

```console
$ safaridriver --port 4444 &
$ RECITE_WEBDRIVER=http://127.0.0.1:4444 pnpm test:safari
```

It skips without that variable, because enabling remote automation changes
someone's browser and is not something a test run should assume. In CI
`RECITE_REQUIRE_SAFARI=1` turns "could not reach Safari" into a failure.

`tools/test/webdriver.test.ts` covers the client against a stubbed transport —
the URL shapes, the `alwaysMatch` capabilities, unwrapping the element key,
treating `no such element` as an absence rather than a fault, and keeping the
remote's own wording when a command fails. That last one matters: the message
this whole exercise is chasing is one Safari produces and nothing else does.

### The bug this found

The safaridriver job paid for itself on its first real run, and the shape of
that is worth recording.

An iPhone on iOS 26.5.4 answered `undefined is not a function (near '...e of
t...')` for every PDF. Chromium CI was green. So was Playwright's WebKit — the
`webkit-phone` row — because that build is WebKit **trunk** and trunk has the
feature the shipping browser lacks. Only real Safari 26.5.2 reproduced it, and
it reproduced every time.

The fault was in `pdfjs-dist`:

```js
const stream = this.streamTextContent(...);
for await (const chunk of stream) { ... }
```

Async iteration of a `ReadableStream` is part of the Streams standard and
Safari has not shipped it, so the iterator is `undefined` and JavaScriptCore
quotes the source it choked on — the `e of t` in the message is that loop,
minified. `apps/web/src/import/stream-async-iterator.ts` installs the missing
iterator; the loop itself is correct and a newer pdf.js would write the same
one.

Two lessons for whoever maintains this next. The engine matters more than the
form factor: no amount of phone-shaped Chromium would have found this, and
neither would WebKit trunk. And **the app catching its own errors made it
invisible** — `FileDrop` puts import failures in `.filedrop-error` rather than
letting them reach `window.onerror`, so a collector watching only `pageerror`
reported "none recorded" through three separate runs. A suite that watches for
faults has to watch where the application puts them.

### What goes in this suite

It is the wide suite, not the deep one. `browser.test.ts` still owns OCR, the
network promise, the editor's geometry and the save formats, on one engine,
because running OCR five times costs twenty minutes to learn one thing. A test
belongs here only if it is cheap and it is about something an engine can differ
on: loading without a script error, running the rule set, reading a file,
opening a PDF, saving, and not overflowing a phone's viewport.

The PDF case earns its place specifically. It is the only path that takes a
dynamic `import()`, and the chunk it pulls in — `pdfjs-dist` and `tesseract.js` —
is the most modern JavaScript the app ships.

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

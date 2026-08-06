# ReCite

**Find and fix broken case law citations** — in a browser tab, or inside
Microsoft Word. A linter for legal writing: it reads a brief, tells you which
citations are wrong, and corrects the ones it can correct safely.

> ### Your document runs in your browser
>
> There is no ReCite server. No account, no upload, no database. Open a file or
> paste text and it is read into memory in the page, checked, and gone when you
> close the tab. It is never transmitted anywhere. That includes scanned PDFs,
> which are read by an OCR engine that also runs in the page.
>
> **One optional feature contacts one outside service.** Supply a
> [CourtListener](https://www.courtlistener.com/) API token and ReCite will
> check that the cases you cite actually exist, and read the page a pin cite
> points at. What it sends is a **volume, a reporter and a page** —
> `volume=410&reporter=U.S.&page=113` — and never a word of your document.
> It is off until you switch it on.
>
> This is not only a promise. The page ships a Content Security Policy with
> `connect-src 'self' https://www.courtlistener.com`, so **the browser itself
> refuses a request to any other host**. The Word add-in is stricter still —
> `connect-src https://www.courtlistener.com`, without even `'self'`, because
> Word hands it the document and it has nothing of its own to load. A test
> loads the built site in a real browser, intercepts every request, and fails
> if one goes anywhere it should not.
>
> Full detail: [**docs/courtlistener.md**](docs/courtlistener.md), including
> what the change to that policy costs and what survives it.
>
> Working with privileged material? See
> [**docs/compliance.md**](docs/compliance.md) — written for a law firm's
> security review, and candid about SOC 2 (ReCite cannot hold a report, and
> why that matters less than it sounds).

|                      |                                                      |
| -------------------- | ---------------------------------------------------- |
| Web app              | <https://wbarnha.github.io/ReCite/>                  |
| Walkthrough          | <https://wbarnha.github.io/ReCite/tutorial.html>     |
| Word add-in manifest | <https://wbarnha.github.io/ReCite/manifest.xml>      |
| Privacy              | <https://wbarnha.github.io/ReCite/privacy.html>      |
| Version              | set by the release tag — see [Releasing](#releasing) |

## Why

A citation can be wrong in ways a spell-checker will never see.

`999 F.3d 1 (2d Cir. 1950)` is impossible — the Federal Reporter's third series
did not exist until 1993 — but it reads perfectly. `200 U.S. 1 (9th Cir. 1906)`
puts a circuit court in the Supreme Court's reporter. `2013 IL App (1st)
111279-U` is an unpublished order that may not be cited as authority at all,
and nothing about its shape says so.

And a citation can be flawless in form and refer to no case whatsoever, which
is exactly the failure mode of a fabricated one. ReCite catches the first three
kinds with no network access at all. The fourth needs something that knows what
exists — an authority list you supply, or
[CourtListener](docs/courtlistener.md) — and the tool is candid about the
difference.

## What it checks

|         | Rule                         | Catches                                                |
| ------- | ---------------------------- | ------------------------------------------------------ |
| `RP001` | reporter-format              | `119 S.Ct. 662`, `20 L.Ed.2d 835`, `12 Fed. Rep. 34`   |
| `RP002` | unknown-reporter             | `12 Cal. Rprt. 3d 45` — a reporter that does not exist |
| `RP003` | inconsistent-reporter-style  | one reporter abbreviated two ways in one document      |
| `DT001` | year-outside-reporter-range  | `999 F.3d 1 (1950)` — the series did not exist yet     |
| `DT002` | implausible-year             | a decision dated in the future                         |
| `CT001` | court-abbreviation           | `(Southern District of New York 1990)`                 |
| `CT002` | reporter-court-mismatch      | `200 U.S. 1 (9th Cir. 1906)`                           |
| `CT003` | court-did-not-exist          | a court cited before it was created                    |
| `CT004` | ambiguous-court              | `App. Div.` — two states use it                        |
| `CT005` | redundant-court              | `526 U.S. 795 (U.S. 1999)` — the reporter already said |
| `CT006` | non-standard-court           | `(9 Cir. 2007)`, `(S.D. New York 1990)`                |
| `ST001` | unresolved-short-form        | `Id.` or `supra` with nothing to point back to         |
| `ST002` | pin-cite-out-of-range        | `410 U.S. 113, 99` — the pin precedes the first page   |
| `ST005` | short-form-parenthetical     | `Griggs, 181 F.3d at 700 (1999)` — a dated short form  |
| `ST006` | section-symbol-count         | `18 U.S.C. § 1544, 1546` — two sections, one `§`       |
| `ST007` | section-range-digits         | `§§ 103-07` — a section span keeps every digit         |
| `AU001` | non-precedential-disposition | an unpublished order cited as authority                |
| `AU002` | database-only-citation       | `2019 WL 4639462` with no reporter cite                |
| `VF001` | unverified-authority         | a citation absent from the authority source            |
| `VF002` | ambiguous-authority          | a citation matching several cases                      |
| `VF003` | case-name-mismatch           | a real citation attached to the wrong case name        |
| `VF004` | year-mismatch                | a year the record disagrees with                       |

Full reference: [docs/rules.md](docs/rules.md).

## Which Bluebook

Two dropdowns, both of which change what is reported:

- **Edition** — 20th (2015), 21st (2020) or 22nd (2025).
- **Rule set** — **Bluepages** for briefs and court documents, **Whitepages**
  for law review footnotes and scholarly writing. The Bluebook is two rule
  sets on differently coloured paper and they do not always agree, so ReCite
  asks which one you are writing to rather than assuming.

From the **21st edition**, the Bluepages let a court filing close up reporter
abbreviations to save space, so `119 S.Ct. 662` is a legitimate choice rather
than an error. Under the **20th**, or under the **Whitepages** — where rule
6.1(a) spacing governs whatever the edition — the same citation wants
`119 S. Ct. 662`.

Permission is not prescription, so ReCite stops _requiring_ the space rather
than requiring its removal. `RP003` still fires when a document uses both
forms: being allowed to tighten is not being allowed to be inconsistent.

Page ranges are read with any dash a document might contain — hyphen, en dash,
em dash, figure dash, non-breaking hyphen — because losing the dash means
losing the pin cite, and losing the pin cite means the page checks silently
stop running.

## Does the case exist?

Every rule above is about form, and a fabricated citation with a plausible
reporter, court and year passes all of them. Answering the other question means
looking the citation up, so **Verify cases against** offers three answers:

| Source            | What "absent" means                                    |
| ----------------- | ------------------------------------------------------ |
| nothing           | not checked; every offline rule still runs             |
| a list you supply | absent from that list — as complete as whoever made it |
| **CourtListener** | absent from a public database of American case law     |

CourtListener is free, run by the [Free Law Project](https://free.law/) — who
also maintain the reporter table ReCite already uses — and needs an
[API token](https://www.courtlistener.com/help/api/rest/). With one pasted in,
the six fabricated cases in the _Mata_ filing come back **not found**, which is
the answer nothing else in this tool can give you.

It is the only feature that contacts anyone, so it is off by default, and what
it sends is a volume, a reporter and a page. Never your document.

### Pincites, as comments

With CourtListener on, **Pull pincites** reads the page each pin cite points at
and shows you the passage. `Miller, 174 F.3d at 371` stops being a page number
you have to trust and becomes a sentence you can read next to the proposition
it is cited for.

Each quotation is written into the saved `.docx` or `.odt` as a **real
comment**, in the margin next to the citation — so it survives being emailed to
someone who has never heard of ReCite. In the Word add-in they become Word
comments in the open document. A comment never changes a character of the text.

Where a page is not marked in CourtListener's copy of the opinion, ReCite says
so and quotes nothing. A quotation attributed to the wrong page is worse than
no quotation, and it is the kind of wrong that survives into a filing.

See [docs/courtlistener.md](docs/courtlistener.md) for the rate limits, the
status mapping, and what the policy change costs.

## Opening a document

Drag a file in, or choose one. ReCite reads it in the page — there is no upload
step, because there is nowhere to upload to.

| Format                     | How it is read                                                                                    |
| -------------------------- | ------------------------------------------------------------------------------------------------- |
| `.txt` `.md` `.csv` `.log` | directly                                                                                          |
| `.rtf`                     | a parser that keeps the characters citations need — section signs, en and em dashes, curly quotes |
| `.docx`                    | the browser's own `DecompressionStream`, no ZIP library                                           |
| `.odt`                     | the same, with ODF's different text model                                                         |
| `.html` `.htm` `.xml`      | a tag scanner, script and style content dropped                                                   |
| `.pdf` (with a text layer) | read directly — exact, no guessing                                                                |
| `.pdf` (scanned)           | **OCR**, in the browser, via [Tesseract.js](https://github.com/naptha/tesseract.js)               |

Format is decided by content first and extension second, because a `.doc` that
is really a `.docx` is common enough in a firm that trusting the name would
produce mangled text — and mangled text in a citation checker means wrong
findings rather than an obvious failure.

Legacy binary `.doc` is **refused**, deliberately. Reading it reliably needs a
real implementation of a format from 1997, and a half-working one returns
plausible text with pieces missing, which is the worst possible outcome here.
Save as `.docx`, `.rtf` or `.txt` instead.

### An opened file becomes a document

A textarea is the right control for pasting a paragraph and checking one
citation. It is the wrong one for a brief. So when a **file** is opened — not
when text is pasted — the document becomes a page: serif type, paragraph
structure, the findings marked where they are in the text, and the pincite
quotations in a margin beside the citations they belong to.

|                    |                                                            |
| ------------------ | ---------------------------------------------------------- |
| Editing            | type, cut, paste, undo                                     |
| Formatting         | bold, italic, underline — toolbar or <kbd>Ctrl</kbd>+B/I/U |
| Findings           | marked in the text as you check, by severity               |
| Fixes              | applied in place, keeping the formatting around them       |
| Pincite quotations | in the margin, anchored to the citation                    |

There is no rich-text library behind it. Findings are painted with the
browser's own Custom Highlight API rather than wrapped in elements, so nothing
ReCite draws ever reaches the saved file; marks live in a document model rather
than in `execCommand`, so a fix landing inside a bold citation gives back a
bold citation. See [docs/editor.md](docs/editor.md).

**ReCite still does not read the formatting of a document you open.** It works
on the text of citations. What is new is that the formatting _you_ apply is
kept, and is written out when you save — an editor that silently un-bolded a
case name would be worse than no editor at all.

A checkbox goes back to the plain text box, and back again. Neither surface is
a trap.

### Scanned PDFs

Pages that already have a text layer are read directly; only pages without one
are recognised. That is an accuracy decision as much as a speed one — OCRing a
page that already has perfect text can only make it worse. The **OCR** dropdown
overrides it: _every page_ for a scanner that baked in a bad text layer,
_never_ when you want no guessed characters in the result at all.

Opening the same file twice in one sitting is instant — the text is kept in
memory for the tab. Only in memory: a document is still gone when you close it,
which is the promise the tool is sold on, so nothing is written to IndexedDB or
any other store that would outlive the page. There is a **Forget opened
documents** link if you want it gone sooner.

The engine downloads only when there is evidence a PDF is coming: dragging one
over the drop zone exposes its type before the drop, so dragging a Word file
still fetches nothing.

**OCR is a machine reading a picture, and it misreads characters** — `1` for
`l`, `0` for `O`, `5` for `S`. Those are exactly the characters citations are
made of, so a volume or page recovered this way can be wrong while looking
right. ReCite says so when it has used OCR, and reports how many pages.

The engine, its WebAssembly core and its English language model are published
with the app and served from the same origin. Tesseract.js defaults to a CDN
for all three; every one is overridden, so opening a scan does not tell anyone
else that you did. Nothing downloads until you actually open a PDF — the
first-load bundle is unaffected.

## Try it on the document that made this necessary

The affirmation from _Mata v. Avianca_ — the brief that cited six cases which
did not exist — is published with the app:

|             |                                                              |
| ----------- | ------------------------------------------------------------ |
| The filing  | <https://wbarnha.github.io/ReCite/mata-v-avianca-filing.pdf> |
| Walkthrough | <https://wbarnha.github.io/ReCite/tutorial.html>             |

Press **Try the example filing** in the app, or drag the PDF in. Eleven pages,
part typed and part scanned exhibit, so it exercises the PDF text layer and the
OCR path in one go — about forty seconds, and it finds 25 citations.

The walkthrough goes through it step by step, and the step that matters most is
the one where **ReCite does not report the fabricated cases**. `925 F.3d 1339
(11th Cir. 2019)` is not a real citation, but the volume is plausible, the
series was running in 2019, and the Eleventh Circuit publishes there. Every
offline rule passes, because every offline rule is about form. Catching a
fabrication needs something that knows what exists — which is the whole lesson,
the reason the walkthrough exists, and the reason
[the CourtListener check](#does-the-case-exist) does.

## Saving

Choose a format under **Save as**:

|                 |                                                   |
| --------------- | ------------------------------------------------- |
| Document        | `.txt` `.md` `.docx` `.odt` `.rtf` `.html` `.pdf` |
| Findings report | JSON, CSV, Markdown                               |

Pincite quotations ride along as real comments in `.docx` and `.odt`, and as
data in every report format. The other formats have no notion of a comment, and
ReCite does not invent one — the **Save as** note says so rather than dropping
them quietly.

Bold, italic and underline applied in the editor survive into `.docx`, `.odt`,
`.rtf` and `.html`. Not into the PDF: it is written directly, using Helvetica,
with no second font embedded to switch to — which the format note says rather
than dropping the emphasis silently.

The list mirrors what ReCite can read, because a tool that opens a `.docx` and
can only hand back a `.txt` has quietly lost the user's format. The writers are
dependency-free — `.docx` and `.odt` are built with the browser's own
`CompressionStream`, and the PDF is written directly, using Helvetica so
nothing has to be embedded.

Everything is built in the page and handed to the browser as a download. There
is no upload and no round trip, exactly as when reading a file. Reports record
the commit that produced them, so a note in a file can be traced to an exact
build.

## Fixing

`Fix` applies only **safe** corrections by default — the ones that change how a
citation is spelled but not which authority it points to. Anything that changes
the case, court or year is held back behind an explicit opt-in, because a
confidently wrong citation is worse than a visibly broken one.

Corrections are span-based and applied back-to-front, and two rules are never
allowed to rewrite the same citation: the second is refused and reported rather
than silently producing nonsense.

## In Word

Install the manifest above; a **Citations** group appears on the Home tab. The
pane reads the open document, lists what it finds, and writes back the fixes
you accept.

Office.js exposes no character offsets, so each correction is re-expressed as
"replace the Nth occurrence of this exact string" before anything is edited.
See [docs/word-add-in.md](docs/word-add-in.md).

## Verifying a build

Every deployment publishes `checksums.sha256` and `integrity.json`, and the
HTML carries SHA-384 Subresource Integrity on every local script, stylesheet
and preloaded module — so a tampered asset fails to execute rather than failing
to be noticed.

```console
$ curl -fsSLO https://wbarnha.github.io/ReCite/checksums.sha256
$ sha256sum -c checksums.sha256
```

CI re-fetches the live site after each deploy and checks it against its own
digests. See [docs/security.md](docs/security.md).

## Releasing

Publish a GitHub release tagged `vMAJOR.MINOR.PATCH`. The tag is the version;
nothing is edited by hand.

| Artefact                    | From `v1.2.3` |
| --------------------------- | ------------- |
| npm packages                | `1.2.3`       |
| Word add-in `<Version>`     | `1.2.3.0`     |
| `integrity.json`, UI footer | `1.2.3.0`     |

Office requires four numeric components and does not accept semver, so the
manifest gets the tag's three numbers followed by a zero. **The fourth
component is always zero** — see [CONTRIBUTING.md](CONTRIBUTING.md#versioning)
for why, and for what happens to a prerelease tag.

Publishing the release builds the site, redeploys Pages so the served
`manifest.xml` carries the new version, and attaches the manifest, the
checksums and the packed npm tarballs to the release. The workflow re-reads
`<Version>` out of the generated manifest and fails if it disagrees with the
tag. A tag it cannot parse fails the release rather than falling back to the
baseline in [`version.json`](version.json).

```console
$ pnpm version:show                        # what would this build be?
$ RECITE_VERSION=v1.2.3 pnpm version:show  # rehearse a release
```

## Which build am I looking at?

The footer shows the version, the **commit**, and the build time. The commit is
a link to the source it was built from.

That matters more than the version here: the site deploys on **every push to
the default branch**, so the version number alone does not identify a build.
The commit does. Compare it against
[`integrity.json`](https://wbarnha.github.io/ReCite/integrity.json) to confirm
the page in front of you is the build you think it is.

Releases are separate. A published GitHub release builds the Word add-in and
attaches the manifest, checksums and npm tarballs to the release itself —
see [Releasing](#releasing). It does not touch Pages.

## Layout

A pnpm workspace. Each package is plain TypeScript with no runtime
dependencies; React and Vite live only in the app.

```
packages/
├── core/          model, regex parser, reporter + court tables, span patching
├── rules/         the 19-rule set — the only place that decides "wrong"
├── engine/        check/fix orchestration
└── courtlistener/ the only package that can open a connection
apps/
└── web/      the web app and the Word task pane, from one build
tools/
├── reporters-db/ pins, fetches and transforms the upstream reporter table
├── version/   works out the release version from the git tag
├── pages/     generates the walkthrough, privacy, terms and support pages
├── tessdata/  publishes the OCR language model alongside the app
├── manifest/  generates manifest.xml for wherever it is deployed
├── integrity/ SHA-256 checksums, SRI injection, verification
└── icons/     draws the add-in icons at build time
```

The dependency graph is the design: `rules` depends only on `core`, so a rule
_cannot_ touch the network or the filesystem — nothing in its scope can. That
is why `courtlistener` is a sibling rather than a layer: it depends on `core`
too, and nothing in `rules` can reach it. Verification results arrive as plain
data, so the rule set and whatever supplied the authority list know nothing
about each other — which is why pointing `VF001` at a real database took no
change to a single rule.

## Develop

```console
$ pnpm install
$ pnpm dev            # web app on :3000
$ pnpm test           # 1103 tests
$ pnpm check          # lint + format + types + tests, what CI runs
$ pnpm build:release  # build, generate manifest.xml, write checksums
```

### Linting

`pnpm lint` is scoped to what each part of the codebase can actually get
wrong, so a failure always means what it says:

| Where          | What is checked                                                                                                                                                                                               |
| -------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| everywhere     | `eslint-plugin-regexp` — the parser _is_ regular expressions, and this reads them as a language rather than as strings. It is the check that catches super-linear backtracking before a user's document does. |
| `apps/web/src` | `react-hooks` dependency arrays, plus `jsx-a11y`. A stale dependency here shows up as a check that silently uses the previous Bluebook profile.                                                               |
| `**/*.ts`      | type-aware `typescript-eslint`, including `no-floating-promises` — the engine is async, and a dropped rejection would report a clean document because the check never ran.                                    |
| `**/test`      | `vitest` rules. A stray `.only` would leave CI green while running almost nothing.                                                                                                                            |

Type-aware rules need every file to belong to a TypeScript project, so tests
and `tools/` have their own `tsconfig.json` and are referenced from the root.
That means `pnpm typecheck` covers them too, which it previously did not.

## Reference data

**Reporters come from [`reporters-db`](https://github.com/freelawproject/reporters-db)**,
maintained by the Free Law Project — 1,342 editions and 2,250 recognised
misspellings, against the 51 this project once maintained by hand.

It is **vendored, not fetched**: generated from a pinned upstream tag and
committed, so a build produces the same table whatever upstream is doing today.
That matters more here than in most projects. Reporter date ranges are what
decides that `999 F.3d 1 (1950)` is impossible, so a table that changed under a
deploy would change what ReCite tells a lawyer about their brief with no change
in this repository.

```console
$ pnpm reporters:check                # is upstream ahead of the pin?
$ pnpm reporters:sync --ref v3.2.70   # move it, and read the diff
```

Nothing updates automatically, and a weekly workflow reports a new release
rather than taking it. See [docs/reporters-db.md](docs/reporters-db.md) for the
architecture, what the transform decides and why, and what absorbing the data
cost.

The court table is still local. The parser fixtures are transcribed from a
public court filing; see [docs/testing.md](docs/testing.md).

## Caveats

- ReCite reads plain text. Convert PDFs before pasting.
- Coverage is United States case law. Statutes are recognised but not checked.
- Reporter and court tables cover the federal system, the regional reporters
  and the larger state series. They are not exhaustive, and `RP002` only speaks
  up when an unknown reporter is a near-miss for a known one.
- **A clean run is not a guarantee.** ReCite proves specific things are wrong.
  It cannot prove a citation is right, and it is not legal advice.
- **Absence from CourtListener is not proof of fabrication**, and a quotation
  it pulls is evidence to check rather than a substitute for reading the
  opinion. It is also not a citator: nothing here tells you an authority has
  been overruled.

## Licence

BSD 2-Clause. See [LICENSE](LICENSE).

Reporter data from [`reporters-db`](https://github.com/freelawproject/reporters-db),
BSD 2-Clause, Copyright (c) 2014, Free Law Project. The Free Law Project
maintains it as a public good, and ReCite would be substantially worse without
it.

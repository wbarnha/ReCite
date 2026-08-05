# ReCite

**Find and fix broken case law citations** — in a browser tab, or inside
Microsoft Word. A linter for legal writing: it reads a brief, tells you which
citations are wrong, and corrects the ones it can correct safely.

> ### Everything runs in your browser
>
> There is no ReCite server. No account, no upload, no database, no API. Open a
> file or paste text and it is read into memory in the page, checked, and gone
> when you close the tab. It is never transmitted anywhere. That includes
> scanned PDFs, which are read by an OCR engine that also runs in the page.
>
> This is not only a promise — the page ships a Content Security Policy with
> `connect-src 'self'`, so **the browser itself refuses any request to another
> origin**. The Word add-in is stricter still (`connect-src 'none'`), because
> Word hands it the document and it has nothing to load. A test loads the built
> site in a real browser, intercepts every request, and fails if one leaves the
> origin.
>
> Working with privileged material? See
> [**docs/compliance.md**](docs/compliance.md) — written for a law firm's
> security review, and candid about SOC 2 (ReCite cannot hold a report, and
> why that matters less than it sounds).

|                      |                                                      |
| -------------------- | ---------------------------------------------------- |
| Web app              | <https://wbarnha.github.io/ReCite/>                  |
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
kinds with no network access at all; the fourth needs an authority list, and
the tool is candid about the difference.

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
| `ST001` | unresolved-short-form        | `Id.` or `supra` with nothing to point back to         |
| `ST002` | pin-cite-out-of-range        | `410 U.S. 113, 99` — the pin precedes the first page   |
| `AU001` | non-precedential-disposition | an unpublished order cited as authority                |
| `AU002` | database-only-citation       | `2019 WL 4639462` with no reporter cite                |
| `VF001` | unverified-authority         | a citation absent from your authority list             |
| `VF002` | ambiguous-authority          | a citation matching several cases                      |
| `VF003` | case-name-mismatch           | a real citation attached to the wrong case name        |
| `VF004` | year-mismatch                | a year the record disagrees with                       |

Full reference: [docs/rules.md](docs/rules.md).

## Which Bluebook

Pick the edition and the kind of writing; both change what is reported.

From the **21st edition**, a court filing may close up reporter abbreviations
to save space, so `119 S.Ct. 662` is a legitimate choice rather than an error.
Under the **20th**, or in **scholarly writing** — where rule 6.1(a) spacing
governs whatever the edition — the same citation wants `119 S. Ct. 662`.

Permission is not prescription, so ReCite stops _requiring_ the space rather
than requiring its removal. `RP003` still fires when a document uses both
forms: being allowed to tighten is not being allowed to be inconsistent.

Page ranges are read with any dash a document might contain — hyphen, en dash,
em dash, figure dash, non-breaking hyphen — because losing the dash means
losing the pin cite, and losing the pin cite means the page checks silently
stop running.

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
| `.pdf` (scanned)           | **OCR**, in the browser, via [Scribe.js](https://github.com/scribeocr/scribe.js)                  |

Format is decided by content first and extension second, because a `.doc` that
is really a `.docx` is common enough in a firm that trusting the name would
produce mangled text — and mangled text in a citation checker means wrong
findings rather than an obvious failure.

Legacy binary `.doc` is **refused**, deliberately. Reading it reliably needs a
real implementation of a format from 1997, and a half-working one returns
plausible text with pieces missing, which is the worst possible outcome here.
Save as `.docx`, `.rtf` or `.txt` instead.

### Scanned PDFs

Pages that already have a text layer are read directly; only pages without one
are recognised. That is an accuracy decision as much as a speed one — OCRing a
page that already has perfect text can only make it worse.

**OCR is a machine reading a picture, and it misreads characters** — `1` for
`l`, `0` for `O`, `5` for `S`. Those are exactly the characters citations are
made of, so a volume or page recovered this way can be wrong while looking
right. ReCite says so when it has used OCR, and reports how many pages.

The engine and its English language model are published with the app and served
from the same origin. Scribe's default is to pull models from a CDN; that is
overridden, so opening a scan does not tell anyone else that you did. Nothing
downloads until you actually open a PDF — the first-load bundle is unaffected.

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

## Layout

A pnpm workspace. Each package is plain TypeScript with no runtime
dependencies; React and Vite live only in the app.

```
packages/
├── core/     model, regex parser, reporter + court tables, span patching
├── rules/    the 19-rule set — the only place that decides "wrong"
└── engine/   check/fix orchestration
apps/
└── web/      the web app and the Word task pane, from one build
tools/
├── version/   works out the release version from the git tag
├── manifest/  generates manifest.xml for wherever it is deployed
├── integrity/ SHA-256 checksums, SRI injection, verification
└── icons/     draws the add-in icons at build time
```

The dependency graph is the design: `rules` depends only on `core`, so a rule
_cannot_ touch the network or the filesystem — nothing in its scope can.
Verification results reach it as plain data, so the rule set and whatever
supplies the authority list know nothing about each other.

## Develop

```console
$ pnpm install
$ pnpm dev            # web app on :3000
$ pnpm test           # 673 tests
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

The reporter and court tables in `packages/core/src/data/` list abbreviations,
full names and the years each reporter series and court has been in operation,
compiled from public sources. The parser fixtures are transcribed from a public
court filing; see [docs/testing.md](docs/testing.md).

## Caveats

- ReCite reads plain text. Convert PDFs before pasting.
- Coverage is United States case law. Statutes are recognised but not checked.
- Reporter and court tables cover the federal system, the regional reporters
  and the larger state series. They are not exhaustive, and `RP002` only speaks
  up when an unknown reporter is a near-miss for a known one.
- **A clean run is not a guarantee.** ReCite proves specific things are wrong.
  It cannot prove a citation is right, and it is not legal advice.

## Licence

BSD 2-Clause. See [LICENSE](LICENSE).

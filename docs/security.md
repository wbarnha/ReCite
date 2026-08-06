# Verifying a build

ReCite is a static site. Anyone who can write to the hosting can change the
code that runs in your browser and, through the Word add-in, the code that
reads your documents. These are the mechanisms that let you check what you are
actually running.

## What is published

Every deployment ships two files describing itself:

| File                                                                    | What it is                                                |
| ----------------------------------------------------------------------- | --------------------------------------------------------- |
| [`checksums.sha256`](https://wbarnha.github.io/ReCite/checksums.sha256) | SHA-256 of every file, in `sha256sum -c` format           |
| [`integrity.json`](https://wbarnha.github.io/ReCite/integrity.json)     | the same digests, plus the version, commit and build time |

The footer of the app shows the version and commit it was built from, so you
can compare the page in front of you against these files without leaving it.

## Checking the published site

```console
$ base=https://wbarnha.github.io/ReCite
$ curl -fsSLO "$base/checksums.sha256"
$ while read -r digest path; do
    curl -fsSL --create-dirs -o "$path" "$base/$path"
  done < checksums.sha256
$ sha256sum -c checksums.sha256
```

Every line should say `OK`. CI does exactly this against the live site after
each deploy — see the `verify-published` job in
[`.github/workflows/deploy.yml`](../.github/workflows/deploy.yml) — so a
mismatch fails the build rather than waiting for someone to notice.

## Checking a build you made yourself

```console
$ pnpm build:release
$ pnpm verify:checksums
ReCite 1.0.0.0, commit 1a2b3c4d5e6f, built 2026-08-04T13:38:53.676Z
OK: 18 files match their recorded SHA-256 digests.
```

`verify:checksums` also accepts a directory, so you can point it at a
downloaded copy of the deployed site:

```console
$ pnpm verify:checksums ./downloaded-site
```

It fails on three things, and all three matter:

- **CHANGED** — a file's bytes differ from the recorded digest.
- **MISSING** — a file the build produced is not there.
- **EXTRA** — a file is being served that the build did not produce. Content
  nobody recorded is as much of a problem as content that changed.

## Subresource Integrity

The published HTML carries a SHA-384 `integrity` attribute on every local
script, stylesheet and preloaded module. A browser that fetches an asset whose
bytes do not match refuses to execute it, so tampering fails closed at load
time without anyone running a command.

`modulepreload` is covered as well as `script`, and deliberately: Vite emits
the entry point as a `<script>` and the shared chunk — most of the application
— as a preload, and an ES module import does **not** inherit the importing
script's integrity. Pinning only `<script>` would leave the bulk of the code
unprotected while looking like it was covered. CI asserts that no local asset
reaches the HTML without an `integrity` attribute.

One script is intentionally _not_ pinned: `office.js`, which Office requires be
loaded from Microsoft's CDN and which Microsoft updates in place. Pinning it
would break the add-in the next time they shipped.

## What these mechanisms do not do

- They prove a build matches its checksums, not that the source is correct or
  that the person who published it should be trusted.
- The digests are published on the same host as the site. Someone who can
  replace the assets can replace `checksums.sha256` too. The value is in the
  independent copies: the CI logs, the build artifact attached to each run, and
  the commit in git.
- Nothing here is a substitute for reading the diff.

## Review findings

The project was reviewed for security in the course of adding the Bluebook
edition support. What was looked at, and what came of it.

### Fixed: quadratic blowup in the `supra` pattern

The pattern matched an optional run of capitalised words before the literal
`supra`. That is quadratic — at every position the engine consumed as many
words as it could, failed to find `supra`, and backtracked through all of
them. A document of 16,000 capitalised words took **2.2 seconds**, growing
fourfold with each doubling.

Since ReCite runs in a Word task pane on whatever the user pastes, that is a
denial of service against the person using it: the pane stops responding. The
name is now recovered by a bounded backwards walk instead, which is linear.
The same input now parses in under a millisecond, and
`packages/core/test/robustness.test.ts` fails if the growth returns.

### Fixed: quadratic trim in the court parenthetical

Found later, by the linter rather than by reading — see [Linting](#linting)
below.

`splitParenthetical` trimmed whitespace and punctuation off its result with
`replace(/^[\s,;]+|[\s,;]+$/g, "")`. This is a common idiom and it is
quadratic. The second branch is anchored only at its end, so the engine
retries it at every offset in the string, and at each one it consumes the
whole remaining run of separators before the `$` finally rejects it.

A parenthetical of `Jan` followed by 50,000 spaces spent **2.2 seconds**
inside that single `String.replace`. Parenthetical text comes from the
document being checked, so its length is not ours to assume. The trim is now
a character loop; the same input takes well under a millisecond, and 800 KB
takes 10 ms.

Two things are worth recording about how this was found. The first is that it
survived a deliberate ReDoS review — the review read the citation _patterns_,
and this was in a `String.replace` that did not look like parsing. The second
is that the first fix was wrong: rewriting the neighbouring date regex removed
a genuine ambiguity but left the timing unchanged, because the cost was one
line further down. Measuring after the fix, not just before it, is what caught
that.

### Added: an input ceiling

Every pattern being linear is not the same as being free. `parse()` now
refuses a document over 8,000,000 characters — roughly 2,500 pages — instead
of working through it on the UI thread.

It refuses rather than truncates, and that is the point. A checker that
silently read the first few megabytes would report a clean document, and
nobody could tell that from a document that was actually clean. `InputTooLarge`
is a named type so a caller can tell a document the user can split from a
defect they cannot do anything about.

### Fixed: quadratic scan in RP002

The unknown-reporter rule tested every regex match against every citation.
Both run in document order, so a single moving pointer does the same work
linearly. A brief with a few thousand citations is not unusual.

### Added: a Content Security Policy

Both pages carry a restrictive CSP. `connect-src 'none'` is the one that
matters: the app has no server, so nothing should ever open a connection, and
a bug or a compromised dependency cannot quietly post a client's document
somewhere.

`connect-src` differs between the two pages, and the web app's is the weaker
of the two. It is `'self'` rather than `'none'` because reading a scanned PDF
means running an OCR engine, and a WebAssembly engine has to be fetched before
it can run. What survives the change is the part that matters: the browser
still refuses **every cross-origin request**, so document text cannot leave the
machine. The Word task pane keeps `connect-src 'none'`, because Word hands it
the document and it has nothing to load.

The OCR engine and its language model are published beside the application
rather than fetched. Tesseract.js defaults to jsDelivr for its worker, its
WebAssembly core _and_ its `.traineddata`, any of which would have put
a third party in the path of a document check and told them that a request
correlated with OCRing a document had come from that address. `opt.langPath`
`langPath`, `workerPath` and `corePath` override them, and `tools/tessdata`
and `tools/tesseract` publish the files. The fallback URLs are
still strings in the bundle — it is the default in library code we do not
control — so the override is verified rather than assumed: a test loads the
built site in a real browser, intercepts every request, and fails if one leaves
the origin. It caught this working the first time it ran, by showing the model
being fetched from the local server.

`script-src` differs between the two pages, on purpose. The task pane allows
this origin and Microsoft's Office CDN, because Office requires `office.js` be
loaded from there. **The web app allows only `'self'`** — it never loads
`office.js`, so permitting that origin would have allowed a request the page
does not make. That is the difference between a privacy claim that happens to
be true and one the browser enforces, and `tools/test/privacy-claims.test.ts`
fails if either page drifts.

`frame-ancestors` is _not_ set, and cannot usefully be: browsers ignore it when
it arrives in a `<meta>` element, and GitHub Pages cannot set response headers.
Restricting framing would need a host that can. It is worth knowing this is
absent rather than assuming it is covered — though note the Word task pane is
itself framed by Office, so any such policy would have to permit that.

### Hardened: the post-deploy verification loop

The deploy workflow fetches `checksums.sha256` from the live site and walks
it. That file arrives over the network, so its contents are now treated as
untrusted: a path containing `..` or a leading `/` is refused rather than
written, and each digest is checked to look like a digest before use.

### Tightened: workflow permissions

`ci.yml` now declares `permissions: contents: read`. It only ever reads the
repository, and stating that means any future change needing more has to say
so in a diff someone reviews. The deploy workflow already declared the
minimum Pages needs.

### Looked at, nothing to fix

- **No injection sinks.** No `innerHTML`, `dangerouslySetInnerHTML`, `eval`
  or `new Function` anywhere. All output goes through React children, which
  escape. A citation containing `<script>` is displayed as text. `react/no-danger`
  is now an error, so re-introducing one is a build failure rather than a
  review question.
- **No network calls and no storage.** No `fetch`, no `XMLHttpRequest`, no
  `localStorage`, no cookies. Document text never leaves the page. The only
  external request in the whole application is Office.js, which Office
  requires be loaded from Microsoft.
- **Other backtracking shapes.** Long space runs, unclosed parentheses, deep
  nesting, digit and dash storms, and repeated partial reporter prefixes were
  all measured. All are linear and finish in milliseconds; each is pinned by
  a test.
- **Supply chain.** `pnpm-lock.yaml` is committed and CI installs with
  `--frozen-lockfile`. The packages have no runtime dependencies at all; React
  and Vite are confined to the app.
- **Word permissions.** The manifest asks for `ReadWriteDocument`, which is
  what reading citations and applying a fix requires, and nothing more.

## Linting

Two of the findings above were quadratic backtracking in a regular
expression, and both were found by hand. That does not scale, so the check is
now automated: `eslint-plugin-regexp` runs over every pattern in the
repository on every commit, and `regexp/no-super-linear-backtracking` is an
error.

Turning it on found a third instance immediately — the date suffix in
`splitParenthetical`, which had a genuine three-way whitespace ambiguity.
That one is a fair illustration of the limits as well as the value: the
linter flagged the ambiguous pattern correctly, but the two seconds were
being spent one line below, in a `String.replace` the linter had nothing to
say about because the regex itself is unambiguous. It is a good tripwire, not
a proof of linearity. The timing tests in
`packages/core/test/robustness.test.ts` remain the thing that actually holds
the line.

Which is why `packages/core/test/redos.test.ts` now enumerates
`buildPatterns()` rather than taking a list: every pattern is crossed with
twelve adversarial input shapes, so a pattern added next year is covered the
day it is written by someone who does not have to know this file exists. It
asserts a growth ratio rather than a wall-clock budget — quadratic grows about
sixteenfold when the input grows fourfold, and comparing a pattern against
itself stays meaningful on a loaded runner. Planting a superlinear pattern
confirms it is caught.

`react/no-danger` and `@typescript-eslint/no-floating-promises` are enforced
for the same reason: both describe a property this codebase already has, and
the point of enforcing them is that losing it becomes visible.

## Dependencies

What reaches a browser: React, React DOM, and — only if someone opens a PDF —
`pdfjs-dist` to read it and `tesseract.js` to recognise the scanned pages. That
is the whole runtime dependency tree, and every item in it is permissively
licensed: React is MIT, the other two are Apache-2.0.

That last point was not free. ReCite previously used `scribe.js-ocr`, which is
**AGPL-3.0** — a licence this project is not under, on a bundle published from
GitHub Pages. It was replaced rather than relabelled, because an AGPL
dependency that is still shipped is still distributed whether or not anything
reaches it. The replacement was measured before it was adopted and needed one
fix to match on accuracy; `docs/testing.md` records both, including the
citation the old stack read correctly and the new one initially invented.

The PDF pair is the substantial dependency now, taken on deliberately for a
capability that cannot be written from scratch. Two things bound it. It is
**lazily loaded**, from a module nothing imports statically, so a visitor who
never opens a PDF never downloads a byte of it — the first-load bundle is
unchanged. And its **CDN defaults are overridden**, as described above.

Everything else the file import handles — `.docx`, `.odt`, `.rtf`, `.html` —
is parsed with no dependency at all. The office formats are ZIP archives, and
the browser has had an inflate built in for years (`DecompressionStream`);
taking a ZIP library for that would have meant adding a dependency to the code
path that reads a client's document. The three published packages — `core`, `rules`, `engine` —
have none at all, which is why a rule cannot reach the network: nothing in its
scope can.

CI audits at two thresholds on every commit. What ships is audited at `low`,
because anything there is a vulnerability in the product. The toolchain is
audited at `moderate`, because it runs on maintainer machines and on a runner
holding a token — a compromise there is a supply-chain compromise of the
release, even though none of it reaches a user. The lockfile is checked
against the manifests so a hand-edited or stale one cannot install silently.

The one asset not bundled is `office.js`, which Office requires be loaded from
Microsoft's CDN and which therefore cannot carry Subresource Integrity. It
loads only in the Word task pane. The web app's policy does not permit that
origin at all, so the page cannot reach Microsoft even if something tried.

## The one request the application makes

The app fetches exactly one thing at runtime, and only when asked: the example
filing published with it, when someone presses **Try the example filing**. The
URL is built from `document.baseURI`, so it can only resolve to this origin,
and `connect-src 'self'` means the browser would refuse it otherwise.

`tools/test/privacy-claims.test.ts` pins the call site — a second `fetch`
anywhere in the shipped source fails the test. That is deliberately annoying:
adding one should require an argument, not a commit.

Saving a document involves no request at all. The file is built in the page and
handed to the browser as an object URL.

## Reporting a problem

Open an issue. If it is a vulnerability rather than a bug, say so in the title
and leave out the details until someone can reply.

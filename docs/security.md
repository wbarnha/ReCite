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
OK: 15 files match their recorded SHA-256 digests.
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

### Fixed: quadratic scan in RP002

The unknown-reporter rule tested every regex match against every citation.
Both run in document order, so a single moving pointer does the same work
linearly. A brief with a few thousand citations is not unusual.

### Added: a Content Security Policy

Both pages now carry a restrictive CSP. `connect-src 'none'` is the one that
matters: the app has no server, so nothing should ever open a connection, and
a bug or a compromised dependency cannot quietly post a client's document
somewhere. `script-src` allows only this origin and Microsoft's Office CDN.

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

`react/no-danger` and `@typescript-eslint/no-floating-promises` are enforced
for the same reason: both describe a property this codebase already has, and
the point of enforcing them is that losing it becomes visible.

## Reporting a problem

Open an issue. If it is a vulnerability rather than a bug, say so in the title
and leave out the details until someone can reply.

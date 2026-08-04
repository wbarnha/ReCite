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

## Reporting a problem

Open an issue. If it is a vulnerability rather than a bug, say so in the title
and leave out the details until someone can reply.

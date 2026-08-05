# The Word add-in

ReCite runs inside Word as a task pane. It reads the open document, reports
citation problems, and writes back the corrections you accept.

## Install

The manifest is served from the same place as the app:

**<https://wbarnha.github.io/ReCite/manifest.xml>**

1. Save that file locally.
2. In Word, choose **Home → Add-ins → More Add-ins → My Add-ins →
   Upload My Add-in**.
3. Pick the file you saved.
4. A **Citations** group appears on the **Home** tab. Choose **Check
   citations** to open the pane.

On Word for Mac the upload option is under **Insert → Add-ins → My Add-ins**.
For an organisation-wide rollout, an administrator can deploy the same manifest
through the Microsoft 365 admin centre instead.

## What it can see, and what it sends

The add-in requests `ReadWriteDocument`, which is what it needs to read the text
and apply a fix. It sends nothing anywhere: the parser, the rule set and the
corpus check all run in the pane. There is no server to send anything to.

The one external request is `office.js` from Microsoft's CDN, which Office
requires — an add-in may not bundle its own copy.

## How a fix is applied

Office.js exposes no character offsets into the document, so a correction
computed against the plain text has to be re-expressed as a search. ReCite
resolves each correction to a needle and an occurrence index _before_ editing
anything — once the first replacement lands, later offsets no longer describe
the document — then replaces the Nth match of that exact string.

The occurrence index is what keeps a fix on the right citation when the same
one appears several times. `countBefore` in
[`apps/web/src/host.ts`](../apps/web/src/host.ts) does that counting, and it is
covered by tests, because getting it wrong would silently corrupt an unrelated
citation elsewhere in the document.

Two consequences worth knowing:

- **Corrections longer than 255 characters are skipped.** That is Word's search
  limit. No citation ReCite rewrites comes close, but the guard is there.
- **The document is re-read and re-checked after every edit**, rather than the
  report being patched in place. Offsets from before an edit no longer mean
  anything, and showing stale ones would be worse than a moment's delay.

## Versioning

Office add-in manifests require exactly four numeric components, and it is not
semver: no prerelease suffix, and each component must be a whole number no
greater than 65535.

The version comes from the published GitHub release tag. `v1.2.3` becomes
`<Version>1.2.3.0</Version>` — the tag's three numbers, then a zero. **The
fourth component is always zero.** Office would let it be a build counter, but
a number that moved independently of the tag could disagree with the release
it shipped in, and this is the version Microsoft sees when the add-in is
submitted.

Nothing is edited by hand: `tools/version/resolve.ts` reads the tag, and the
release workflow checks the generated manifest against it before attaching
anything. `pnpm version:show` prints what the current build would be, and
`RECITE_VERSION=v1.2.3 pnpm version:show` rehearses a release.

An untagged build — local, a branch, a pull request — falls back to the
baseline in [`version.json`](../version.json).

Word keys upgrades on `<Version>`, so a prerelease tag is a trap worth
knowing about: `v1.2.3-rc.1` and `v1.2.3-rc.2` are both `1.2.3.0`, and Word
will not treat the second as newer. The build prints a warning when a tag
carries a prerelease suffix.

Word caches manifests aggressively. After a version bump, remove and re-upload
the add-in if the pane does not change.

## Developing against it

```console
$ pnpm dev
```

Vite serves the pane at `http://localhost:3000/taskpane.html`. To load it in
Word you need a manifest pointing there over HTTPS — Office will not load a
task pane over plain HTTP from anywhere but `localhost`, and requires a
trusted certificate. Generate a local manifest with:

```console
$ RECITE_BASE_URL=https://localhost:3000/ pnpm manifest
```

Opening `taskpane.html` in an ordinary browser is also supported: it detects
that Office is not present and explains how to install the add-in rather than
failing against an API that is not there.

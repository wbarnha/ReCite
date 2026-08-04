# ReCite

**Find and fix broken case law citations** — in a browser tab, or inside
Microsoft Word. A linter for legal writing: it reads a brief, tells you which
citations are wrong, and corrects the ones it can correct safely.

Everything runs locally. There is no server, and no document text is uploaded.

|                      |                                                 |
| -------------------- | ----------------------------------------------- |
| Web app              | <https://wbarnha.github.io/ReCite/>             |
| Word add-in manifest | <https://wbarnha.github.io/ReCite/manifest.xml> |
| Version              | `1.0.0.0`                                       |

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

## Layout

A pnpm workspace. Each package is plain TypeScript with no runtime
dependencies; React and Vite live only in the app.

```
packages/
├── core/     model, regex parser, reporter + court tables, span patching
├── rules/    the 17-rule set — the only place that decides "wrong"
└── engine/   check/fix orchestration
apps/
└── web/      the web app and the Word task pane, from one build
tools/
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
$ pnpm test           # 260 tests
$ pnpm check          # lint + format + types + tests, what CI runs
$ pnpm build:release  # build, generate manifest.xml, write checksums
```

## Provenance

Written from scratch for this repository. The reporter and court tables were
compiled independently from public sources — the names of reporters and courts,
their standard abbreviations and the years they existed are matters of fact
about the published record. No code or data here is copied or derived from any
other citation project.

The parser fixtures are transcribed from a public court filing; see
[docs/testing.md](docs/testing.md).

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

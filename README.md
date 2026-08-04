# ReCite

**Find and fix broken case law citations.** ReCite is a linter for legal
writing: it reads a brief or an opinion, tells you which citations are wrong,
and — where it can do so safely — corrects them.

It is built on the [Free Law Project](https://free.law)'s citation tooling:

| Library | What ReCite uses it for |
| --- | --- |
| [eyecite](https://github.com/freelawproject/eyecite) | finding citations and tying `Id.`/`supra` back to the case they mean |
| [reporters-db](https://github.com/freelawproject/reporters-db) | canonical reporter abbreviations and the years each edition covers |
| [courts-db](https://github.com/freelawproject/courts-db) | court identifiers and Bluebook court abbreviations |
| [CourtListener API](https://www.courtlistener.com/help/api/rest/citation-lookup/) | confirming a cited case actually exists |

```console
$ recite check brief.txt
brief.txt
  16:64  info    RP001  '123 F. 3d 456' should be written '123 F.3d 456' — spacing
                        and punctuation do not match the standard form.
  23:27  error   DT001  F.3d was published 1993–present, but this cites 1950.
                        A 1950 case in this series would be in 'F.2d'.
  30:17  error   CT002  'U.S.' only reports the Supreme Court of the United States,
                        but the parenthetical names Court of Appeals for the Ninth Circuit.
  33:50  error   ST001  A `supra` citation does not follow any full citation.

6 errors, 2 warnings, 3 infos across 10 citations in 1 file.
3 fixable with recite fix; 4 more with --unsafe (review these).
```

## Why

A citation can be wrong in ways a spell-checker will never see. `999 F.3d 1
(2d Cir. 1950)` is impossible — the Federal Reporter's third series did not
exist until 1993 — but it reads perfectly. `200 U.S. 1 (9th Cir. 1906)` puts a
circuit court in the Supreme Court's reporter. And a citation can be flawless
in form and still refer to no case at all, which is exactly the failure mode of
a hallucinated citation.

Checking those by hand is slow and easy to skip. ReCite turns them into a
command you can run in CI.

## Install

```console
git clone https://github.com/wbarnha/ReCite && cd ReCite
uv sync --all-packages
uv run recite check examples/brief.txt
```

Verification against CourtListener needs a free API token:

```console
export COURTLISTENER_API_TOKEN=...
recite check brief.txt --verify
```

Everything else works with no network at all.

## Use

```console
recite check brief.txt                    # report problems, exit 1 on errors
recite fix brief.txt                      # show what would change
recite fix brief.txt --write              # apply formatting fixes
recite fix brief.txt --write --unsafe     # also apply substantive fixes
recite check brief.txt --format sarif     # annotate a pull request
pdftotext brief.pdf - | recite check -    # read from stdin
```

`recite fix` applies only *safe* corrections by default — the ones that change
how a citation is spelled but not which authority it points to. Anything that
changes the case, court or year is held back behind `--unsafe`, because a
confidently wrong citation is worse than a visibly broken one.

## What it checks

| | Rule | Catches |
| --- | --- | --- |
| `RP001` | reporter-format | `123 F. 3d 456`, `550 US 544`, `12 Fed. Rep. 34` |
| `RP002` | ambiguous-reporter | an abbreviation several reporter series share |
| `RP003` | unrecognized-reporter | `12 Cal. Rprt. 3d 45` — a reporter that does not exist |
| `DT001` | year-outside-edition | `999 F.3d 1 (1950)` — the series did not exist yet |
| `DT002` | implausible-year | a decision dated in the future |
| `CT001` | court-abbreviation | `(Southern District of New York 1990)` |
| `CT002` | reporter-court-mismatch | `200 U.S. 1 (9th Cir. 1906)` |
| `CT003` | court-did-not-exist | a court cited before it was created |
| `ST001` | unresolved-short-form | `Id.` or `supra` with nothing to point back to |
| `ST002` | pin-cite-out-of-range | `410 U.S. 113, 99` — the pin precedes the first page |
| `VF001` | unknown-authority | a citation in no database — the hallucination check |
| `VF002` | ambiguous-authority | a citation matching several cases |
| `VF003` | case-name-mismatch | a real citation attached to the wrong case name |
| `VF004` | year-mismatch | a decision year the database disagrees with |

`VF` rules need `--verify`. The rest never touch the network. Full reference:
[docs/rules.md](docs/rules.md).

## Layout

A uv workspace of five packages, each independently installable:

```
packages/
├── recite-core/     model, eyecite extraction, reporters-db + courts-db lookups
├── recite-rules/    the rule set — the only place that decides "wrong"
├── recite-verify/   CourtListener client, chunking, SQLite cache
├── recite-fix/      the check/fix engine
└── recite-cli/      the `recite` command
```

The split is what keeps the rules honest: `recite-rules` cannot perform I/O,
because it does not depend on anything that can. Verification results reach it
as plain data defined in `recite-core`, so rules and the API client know
nothing about each other.

```
document ─▶ extract ─▶ [verify] ─▶ rules ─▶ diagnostics ─▶ [apply fixes]
            (core)     (verify)   (rules)                    (core.text)
```

See [docs/architecture.md](docs/architecture.md) for the reasoning, including
the eyecite metadata bug ReCite works around.

## Develop

```console
make sync        # create the workspace venv
make check       # lint + types + tests, exactly what CI runs
make test
make demo        # run against the deliberately broken example brief
```

The test suite never reaches the network: the CourtListener client is exercised
against a mocked transport, and anything that would make a real request is
marked `network` and deselected.

## Caveats

- ReCite reads plain text. Convert PDFs and Word documents first (`pdftotext`,
  or the Free Law Project's [doctor](https://github.com/freelawproject/doctor)).
- Coverage is United States case law, because that is what `reporters-db` and
  `courts-db` cover. Statutes, regulations and journals are found but not
  checked.
- A clean run is not a guarantee of correctness. ReCite proves specific things
  are wrong; it cannot prove a citation is right.

## Licence

BSD 2-Clause, matching the Free Law Project libraries it builds on. See
[LICENSE](LICENSE).

ReCite is not affiliated with or endorsed by the Free Law Project.

# The reporter table, and where it comes from

ReCite's reporter data is [`reporters-db`](https://github.com/freelawproject/reporters-db),
maintained by the Free Law Project. This is how it gets here, why it is
vendored rather than fetched, and what to do when upstream moves.

## Why vendored

The data is **committed**, generated from a pinned upstream tag by a tool that
runs on demand. Nothing fetches at build time, and nothing fetches in a
browser.

That is not a packaging convenience. Reporter date ranges are what `DT001`
uses to decide that `999 F.3d 1 (1950)` is impossible — the Federal Reporter's
third series did not exist until 1993. If the table were fetched at build time,
the same source would produce different findings depending on what upstream
happened to be serving that afternoon, and a deploy could start or stop
accusing a lawyer's brief with no change in this repository. A citation checker
has to be reproducible before it is anything else.

It also keeps the promise the rest of the project makes: the app runs entirely
in the browser and reaches nothing.

## The shape of it

```
tools/reporters-db/
├── pin.json       the tag, and a SHA-256 for each file fetched
├── fetch.ts       fetch and verify — refuses anything the pin does not match
├── transform.ts   pure: upstream JSON → ReCite's model. No I/O, so it is testable
├── sync.ts        the CLI. Fetch, transform, write, and print what changed
└── check.ts       is upstream ahead of the pin? (a scheduled workflow)

packages/core/src/data/
├── upstream.generated.ts   generated, committed, never edited
├── overlay.ts              what ReCite knows and a catalogue does not
└── reporters.ts            merges the two; the public shape is unchanged
```

## Updating

```console
$ pnpm reporters:check                  # is there anything newer?
$ pnpm reporters:sync --ref v3.2.70     # move the pin
$ pnpm reporters:sync --dry-run         # see the diff without writing
```

The sync prints every reporter added, removed, or **re-dated**. Read it. A
changed date range changes which citations ReCite calls impossible, so this is
a change to what the tool tells a lawyer about their brief, not a dependency
bump.

Nothing updates automatically. `.github/workflows/reporters-db.yml` runs weekly
and reports a newer release as a notice; it never syncs. It _does_ fail if the
pinned revision itself changed — a tag is immutable, so a digest mismatch means
the tag was moved or a file was altered in transit, which is a different and
more serious question than being out of date.

## What the transform decides

Upstream is a catalogue; ReCite is a checker. Three decisions bridge them, and
each one exists to avoid a confident false accusation.

**Ambiguous abbreviations get the union of their date spans.** `Ark.` is two
different reporters with different lifetimes, and there are twenty-odd more
like it. Picking one — which a plain `Map.set` does, and which this project did
before the data arrived — means the year check runs against a reporter the
author may not have meant, and reports a good citation as impossible. The
merged record carries the widest range any claimant supports and is flagged
`ambiguous`, so a rule can tell.

**Undated reporters get a range that accuses nobody.** Four upstream entries
have no start date. Inventing one would be inventing the finding.

**Dates are truncated to years, which widens every range slightly.** A reporter
that began in March 1880 covers 1880. Rounding outward is the safe direction
when the only thing done with a range is to accuse a year outside it.

## What the overlay adds

`reporters-db` records what reporters _are_. It has no reason to record which
ones publish only the Supreme Court (`CT002`) or which carry non-precedential
dispositions (`AU001`), so those live in `overlay.ts`, by hand.

Two properties keep that safe:

- **An annotation matching nothing upstream is a test failure.** This is the
  one way the arrangement can fail silently: a rename upstream leaves
  `scotusOnly` applying to no reporter, the flag stops mattering, and `CT002`
  quietly stops catching a circuit court cited in the Supreme Court's reporter.
  A rule that fails _open_ reports nothing and looks fine. `overlay.test.ts`
  catches it — and did, on its first run, finding two entries that were
  variations rather than editions and had never applied to anything.
- **Nothing local changes a date.** If a date is wrong the fix belongs
  upstream, where everyone benefits. Carrying a local override would mean
  quietly disagreeing with the source ReCite names as its authority.

## What this cost, and what it bought

The table went from 51 hand-written editions to **1,342**, with 2,250
recognised misspellings. A state series nobody thought to type in is no longer
an unknown reporter.

Two things had to change to absorb it:

**The parser stopped matching reporters by name.** It held an alternation of
every known abbreviation, which is fine at fifty and is not at three and a half
thousand — the generated pattern reached **66,829 characters**, and the ReDoS
suite caught two patterns going superlinear the moment the data landed. It now
matches a _shape_ and settles identity with a hash lookup afterwards. The
pattern is 117 characters, a 2,000-citation brief parses in about 50 ms, and it
scales to however many reporters upstream adds next. The cost is that
`123 Main Street 45` fits the shape and has to be discarded by the lookup —
which `parse.ts` does, and which is tested.

**The bundle grew.** About 40 KB gzipped. That is the largest single thing in
the application and it is worth knowing; it is also the whole substance of what
ReCite checks against.

## Licence and attribution

`reporters-db` is BSD-2-Clause, Copyright (c) 2014, Free Law Project — the same
licence as this project. The generated file carries the attribution, and
`pin.json` records the licence and copyright alongside the revision so that
provenance travels with the data rather than living only in a document.

The Free Law Project maintains this data as a public good and ReCite would be
substantially worse without it.

# Contributing

```console
$ pnpm install
$ pnpm check     # lint + format + types + tests — exactly what CI runs
$ pnpm dev       # web app on :3000
```

Node 20 or newer, pnpm 10.

## Ground rules

**Rules stay pure.** `@recite/rules` depends only on `@recite/core`, which does
no I/O. If a rule seems to need the network, it needs a field on a
`VerificationResult` instead — that is what keeps the whole rule set able to
run in a browser tab and inside Word.

**A fix must be right, or absent.** Attach a `correction` only when you can
name the correct text. `safe` is reserved for changes that leave the cited
authority identical: spelling, spacing, abbreviation. Anything that changes
which case, court or year is referenced is `unsafe`.

**Nothing leaves the machine.** No telemetry, no analytics, no fonts or scripts
from a CDN. The one exception is `office.js`, which Office requires be loaded
from Microsoft — and which is documented in
[docs/security.md](docs/security.md) as the one asset not covered by
Subresource Integrity.

**Cite a source for reference data.** When you add a reporter or a court, note
in the pull request where the abbreviation and the dates came from, so the next
person can check them.

## Reports from users

The app composes them: every finding has a **Report** link, and there is one
for citations no rule fired on. They arrive as issues labelled
`citation report`, and they already contain what you would otherwise have to
ask for — the citation as written, the rule and its message, the Bluebook
edition and rule set, what the cases were checked against, whether OCR was
involved, and the commit.

Two things are worth knowing when you read one.

**Check the OCR line first.** It is at the top for a reason: on a scanned
document the likeliest explanation of a wrong finding is not a rule bug but a
misread character, because optical character recognition confuses `1` for `l`
and `5` for `S` and those are what citations are made of.

**The excerpt is deliberately thin.** A report carries the citation and, only
if the reporter ticked the box, the sentence around it — capped at
`MAX_CONTEXT` in `apps/web/src/feedback/report.ts`. If you need more, ask for
the _shape_ of the surrounding text rather than the text: these come out of
documents that are frequently privileged, and the reporter is trusting that
constraint. `apps/web/test/report.test.ts` holds it.

## Adding a rule

1. Add it to the right family module in `packages/rules/src/`.
2. Register it in `REGISTRY` in that package's `index.ts`, and export it.
3. Test it in `packages/rules/test/`. Cover the true positive, at least one
   near-miss that must _not_ fire, and — if it offers a fix — that applying the
   fix produces the text you claim it does.
4. Document it in [docs/rules.md](docs/rules.md).

Rule ids are stable: people put them in reports. Take the next free number in
the family rather than renumbering.

## Adding a citation format

Formats live in [`packages/core/src/patterns.ts`](packages/core/src/patterns.ts),
away from the parser that drives them, so they can be read and tested on their
own.

Before changing a pattern, add a fixture to
`packages/core/test/fixtures/mata-avianca.ts` — or a new fixture file, if the
format is not in that filing — with the text as it actually appears and a note
on what makes the shape hard. Table-driven fixtures mean a regression names the
format that broke rather than a line number.

Watch two things in particular:

- **Shape, not names.** Reporters are matched by what an abbreviation looks
  like and identified afterwards by a hash lookup — there is no alternation of
  known abbreviations any more, and there cannot be: the vendored table has
  3,600 spellings in it. A pattern that over-matches is fine, because the
  lookup discards what is not a reporter; one that under-matches loses the
  citation silently.
- **Longest wins, by construction.** `905 F. Supp. 2d 121` must parse as
  `F. Supp. 2d`, not `F. Supp.`. The shape grows lazily until a bare page
  number can follow, which gets there without anyone ordering a list.
- **Scan order.** Statutes are matched before reporters, because
  `11 U.S.C. § 362` starts out looking like a `U.S.` citation.

## Reference data

**Reporters are vendored from
[`reporters-db`](https://github.com/freelawproject/reporters-db)** and must not
be edited here. `packages/core/src/data/upstream.generated.ts` is generated;
a fix to a reporter's name or dates belongs upstream, where everyone benefits.
Run `pnpm reporters:sync` to regenerate, and see
[docs/reporters-db.md](docs/reporters-db.md).

Two things about reporters _are_ local, in `packages/core/src/data/overlay.ts`:
which reporters publish only the Supreme Court, and which carry
non-precedential dispositions. Neither is something a catalogue records, and
both drive rules. Add to those lists using the **canonical** abbreviation —
an annotation naming a variation applies to nothing, and `overlay.test.ts`
fails when one does.

The court table in `packages/core/src/data/courts.ts` is still maintained here.
Each entry needs the abbreviation, the full name and the years, and those years
are load-bearing — `CT003` is only as good as they are. A wrong end year
produces confident false accusations, which is worse than no rule at all.

## Versioning

**A published GitHub release sets the version.** Tag `v1.2.3`, publish the
release, and the workflows derive everything from the tag:

| Artefact                    | Form      | From `v1.2.3` |
| --------------------------- | --------- | ------------- |
| npm packages                | semver    | `1.2.3`       |
| Word add-in `<Version>`     | four-part | `1.2.3.0`     |
| `integrity.json`, UI footer | four-part | `1.2.3.0`     |

The fourth component of the Office version is **always zero**. Office would
allow a build counter there, but nothing in this project has a number to put
in it, and a component that moved independently of the tag would be one more
thing that could disagree with the release it came from.

[`version.json`](version.json) is now only the _baseline_: what an untagged
build — local, a branch, a pull request — is stamped with. Bump it when
starting work on the next version. Releases do not read it.

Do not edit versions in `package.json` or `manifest.xml` by hand.
`tools/version/resolve.ts` works out the version and
`tools/version/apply.ts` writes it into the package manifests during a
release. Both are inspectable:

```console
$ pnpm version:show                        # what would this build be?
$ RECITE_VERSION=v1.2.3 pnpm version:show  # rehearse a release
$ pnpm version:check                       # package.json files agree?
```

A tag the resolver cannot read — `nightly`, `v1.2`, `release-1.2.3` — fails
the release rather than falling back. Publishing the baseline version under a
tag named something else is how a release ends up claiming to be a version it
is not.

A prerelease tag (`v1.2.3-rc.1`) is accepted: npm gets `1.2.3-rc.1`, and the
manifest gets `1.2.3.0`. Note that every prerelease of a patch produces the
same Office version, so Word will not see a later one as an upgrade. The
build warns about this.

`manifest.xml` is not checked in at all. Almost every value in it is a URL that
has to match the deployment, so it is generated into `dist/` next to the pages
it points at.

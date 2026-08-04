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

**Keep the provenance clean.** Everything here is written from scratch. Do not
copy code or data files from other citation projects, however permissive their
licence. Reporter names, court names, standard abbreviations and publication
years are facts and may be compiled from public sources; someone else's
expression of them may not be.

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

- **Alternation order.** Longer abbreviations must come first, or `F. Supp. 2d`
  parses as `F. Supp.` and loses its series.
- **Scan order.** Statutes are matched before reporters, because
  `11 U.S.C. § 362` starts out looking like a `U.S.` citation.

## Reference data

`packages/core/src/data/` holds the reporter and court tables. Additions are
welcome; each entry needs the abbreviation, the full name and the years, and
those years are load-bearing — `DT001` and `CT003` are only as good as they
are. A wrong end year produces confident false accusations, which is worse than
no rule at all.

## Versioning

[`version.json`](version.json) is the single source of truth. `product`
(`1.0.0.0`) is the four-part form Office add-in manifests require and what the
UI shows; `semver` (`1.0.0`) is what npm accepts. The manifest and the build
metadata are generated from it — do not edit versions in `package.json` or in
`manifest.xml` by hand.

`manifest.xml` is not checked in at all. Almost every value in it is a URL that
has to match the deployment, so it is generated into `dist/` next to the pages
it points at.

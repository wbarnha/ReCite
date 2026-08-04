# Contributing

```console
make sync      # create the workspace venv (uv sync --all-packages)
make check     # lint + types + tests — exactly what CI runs
make fmt       # autoformat and autofix
```

Optional: `pre-commit install`.

## Ground rules

**Tests never touch the network.** The CourtListener client is exercised
against a `respx`-mocked transport and the verifier against an in-process fake.
Anything that genuinely needs the live API is marked `@pytest.mark.network` and
is deselected by `make test` and by CI.

**Rules stay pure.** `recite-rules` depends only on `recite-core`, which has no
I/O. If a rule seems to need the network, it needs a field on
`CitationVerification` instead.

**A fix must be right, or absent.** Attach a `Correction` only when you can
name the correct text. `FixSafety.SAFE` is reserved for changes that leave the
cited authority identical — spelling, spacing, abbreviation. Anything that
changes which case, court or year is `UNSAFE`.

## Adding a rule

1. Add the class to the right family module in
   `packages/recite-rules/src/recite/rules/`, subclassing `Rule`.
2. Register the instance in `_REGISTRY` in that package's `__init__.py`, and
   export it in `__all__`.
3. Test it in `packages/recite-rules/tests/`, using the `check` fixture. Cover
   the true positive, at least one near-miss that must *not* fire, and — if the
   rule offers a fix — that applying the fix produces the text you claim.
4. Document it in `docs/rules.md`.

Rule ids are stable: people put them in configs and suppression comments. Pick
the next free number in the family rather than renumbering.

## Adding a package

Create `packages/recite-<name>/` with a `pyproject.toml` mirroring an existing
one (hatchling, `packages = ["src/recite"]`, no `recite/__init__.py` — the
`recite` namespace is a PEP 420 namespace package). Add it to the root
`[tool.uv.sources]` and the `dev` dependency group. `[tool.uv.workspace]`
already globs `packages/*`.

## Upstream quirks

`docs/architecture.md` documents the eyecite and courts-db behaviours ReCite
works around, and the tests that pin each workaround. If one of them is fixed
upstream, the workaround can go — but delete the workaround and the test
together, and check the version constraint in the relevant `pyproject.toml`
first.

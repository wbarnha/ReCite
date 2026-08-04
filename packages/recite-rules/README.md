# recite-rules

Every check ReCite performs, and the only place that decides what "wrong"
means. Rules are pure functions of a [`RuleContext`](src/recite/rules/base.py):
they read an `Extraction` (plus CourtListener results, when available) and
yield `Diagnostic`s. They never touch the filesystem, the network, or the
document.

## Families

| Prefix | Concern |
| --- | --- |
| `RP` | the reporter abbreviation itself |
| `DT` | the year, checked against reporter publication ranges |
| `CT` | the court parenthetical |
| `ST` | how citations relate to one another in the document |
| `VF` | cross-checks against the CourtListener database |

`recite rules` prints the current set with severities. See
[docs/rules.md](../../docs/rules.md) for the full reference.

## Adding a rule

Subclass `Rule`, then register the instance in `_REGISTRY`:

```python
class VolumeTooHigh(Rule):
    id = "RP004"
    name = "volume-out-of-range"
    summary = "Volume number exceeds the highest volume ever published."
    severity = Severity.ERROR

    def check(self, ctx: RuleContext) -> Iterable[Diagnostic]:
        for citation in ctx.citations:
            ...
            yield self.diagnostic(citation, "…", replacement="…")
```

Two conventions matter:

- **Attach a correction only when you can name the right answer.** A rule that
  cannot say what the text *should* be reports and stops. Guessing is worse
  than a human reading the finding.
- **`FixSafety.SAFE` means the cited authority is unchanged.** Whitespace and
  abbreviation normalisation qualify. Anything that changes which case, court
  or year is referenced is `UNSAFE`, and `recite fix` will not apply it
  without `--unsafe`.

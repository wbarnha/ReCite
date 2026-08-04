# recite-fix

The orchestration layer. `Engine` is the one class most callers need.

```python
from recite.fix import Engine

engine = Engine()  # offline: no CourtListener needed
result = engine.check_file("brief.txt")

for d in result.diagnostics:
    print(d.rule_id, d.severity.value, d.message)
```

Fixing returns the rewritten text rather than touching the file, unless you
ask it to:

```python
fixed = engine.fix_text(brief)  # safe corrections only
print(fixed.diff())

engine.fix_file("brief.txt", unsafe=True, write=True)
```

## Safe vs unsafe

`fix` applies only `FixSafety.SAFE` corrections by default — the ones that
change how a citation is spelled but not which authority it points to
(`123 F. 3d 456` → `123 F.3d 456`). Anything that changes the referenced case,
court or year is `UNSAFE` and needs an explicit opt-in, because a wrong "fix"
to a citation is worse than the original error.

Corrections that would overlap are not applied blindly: `apply_corrections`
keeps the earlier one and reports the rest on `FixResult.skipped`, so nothing
is silently dropped.

## Going online

Pass a `Verifier` to enable the `VF` rules, which is what catches a citation
that is formatted perfectly and simply does not exist:

```python
from recite.verify import CourtListenerClient, LookupCache, Verifier

with CourtListenerClient() as client:
    engine = Engine(verifier=Verifier(client, cache=LookupCache()))
    result = engine.check_file("brief.txt")
```

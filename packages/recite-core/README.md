# recite-core

The foundation layer of [ReCite](../../README.md). It owns the data model that
every other package speaks, and it is the only package that talks directly to
the Free Law Project reference libraries.

| Module | Responsibility |
| --- | --- |
| `recite.core.models` | `ParsedCitation`, `Diagnostic`, `Correction`, `Span`, severities |
| `recite.core.extract` | Thin, offset-preserving wrapper over `eyecite` |
| `recite.core.reporters` | `reporters-db` queries: canonical editions, date ranges, fuzzy suggestions |
| `recite.core.courts` | `courts-db` queries: id ↔ Bluebook court abbreviation |
| `recite.core.text` | Span-safe patching, unified diffs, line/column mapping |

`recite-core` never mutates a document and never performs I/O. It reports what
is in the text; deciding what is *wrong* is `recite-rules`' job and rewriting
is `recite-fix`' job.

```python
from recite.core import extract

result = extract("Roe v. Wade, 410 U. S. 113 (1973). Id. at 116.")
for cite in result.citations:
    print(cite.kind, cite.text, "->", cite.corrected)
```

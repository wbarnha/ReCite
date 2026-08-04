# recite-verify

Cross-checks citations against [CourtListener](https://www.courtlistener.com)'s
[citation-lookup API](https://www.courtlistener.com/help/api/rest/citation-lookup/).
This is what turns ReCite from a formatter into something that can tell you a
citation does not exist.

```python
from recite.core import extract
from recite.verify import CourtListenerClient, LookupCache, Verifier

with CourtListenerClient() as client:  # reads $COURTLISTENER_API_TOKEN
    verifier = Verifier(client, cache=LookupCache())
    report = verifier.verify(extract(brief))

for index, result in report.results.items():
    print(index, result.status, [c.case_name for c in result.clusters])
```

## Per-citation statuses

| Status | Meaning |
| --- | --- |
| `200` | matched exactly one case |
| `300` | matched several — the citation is ambiguous |
| `400` | the reporter does not exist |
| `404` | parses fine, but no such case is in the database |
| `429` | past the per-request cap; never looked up |

## Being a good citizen

The API is free, shared, and rate limited, so this package tries hard not to
waste it:

- **Cache first.** Results are stored in SQLite keyed by canonical citation, so
  a check/fix/re-check loop hits the network once. If every citation is
  cached, no request is made at all.
- **Chunked requests.** The server looks up at most 250 citations per request
  and returns `429` for the rest; `Verifier` sends at most
  `DEFAULT_CHUNK_SIZE` (200) per call, cut at citation boundaries.
- **Never cache a non-answer.** A `429` means the citation was not examined, so
  it is not written to the cache.

A token is required — `CourtListenerClient` raises `MissingTokenError` rather
than making an anonymous request that would be throttled immediately. Tokens
are free. Without one, run ReCite offline: the `RP`/`DT`/`CT`/`ST` rules need
no network.

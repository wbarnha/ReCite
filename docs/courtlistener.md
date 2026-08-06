# Checking against CourtListener

ReCite catches citations that are wrong in ways a spell-checker cannot see:
impossible reporter and year pairings, courts that did not exist, short forms
pointing at nothing. Every one of those checks is about **form**, and every one
of them passes on a citation that is perfectly formed and refers to no case
whatsoever — which is exactly what a fabricated citation looks like.

Catching that needs a source of truth. This is the one ReCite ships with.

[CourtListener](https://www.courtlistener.com/) is a free public database of
American case law maintained by the [Free Law Project](https://free.law/), a
non-profit. It also maintains
[`reporters-db`](https://github.com/freelawproject/reporters-db), which is
where ReCite's reporter table already comes from.

## The short version

|                          |                                                                           |
| ------------------------ | ------------------------------------------------------------------------- |
| Off by default           | Yes. No token, no client, no request.                                     |
| What is sent             | A volume, a reporter abbreviation, a page. Plus your token.               |
| What is never sent       | Your document. There is no code path that could.                          |
| Where the token is kept  | The tab's memory. No cookie, no `localStorage`, no IndexedDB.             |
| Hosts the page can reach | Its own origin, and `https://www.courtlistener.com`. Enforced by the CSP. |

## Turning it on

1. Get a token: **<https://www.courtlistener.com/help/api/rest/>**. It is free.
2. In the app — or in the Word pane — set **Verify cases against** to
   _CourtListener_ and paste the token in.
3. **Check citations.** Every full case citation is looked up.
4. **Pull pincites** reads the page each pin cite points at and attaches the
   passage to the document as a comment.

## What actually leaves the machine

CourtListener's citation-lookup endpoint takes either a block of `text`, which
it scans for citations, or a `volume`, a `reporter` and a `page`.

**ReCite only ever sends the three components.** The `text` form would be fewer
requests and is the obvious optimisation; taking it would mean posting a
client's brief to a third party, which is the one thing this project exists not
to do. The whole request body is built by one function:

```ts
export function buildLookupForm(components: CitationComponents) {
  return {
    volume: components.volume,
    reporter: components.reporter,
    page: components.page,
  };
}
```

`410 U.S. 113` goes out as `volume=410&reporter=U.S.&page=113`. You can watch
it in your browser's network panel, which is the point of form encoding rather
than JSON.

Two tests hold this. One in `packages/courtlistener` posts a document
containing the word `PRIVILEGED` and asserts the request body does not; one in
`tools/test/privacy-claims.test.ts` reads the source of `buildLookupForm` and
fails if it grows a fourth key.

Quoting a pin cite fetches an opinion by the identifier CourtListener itself
returned. The URL is checked against the fixed origin before it is followed, so
a response cannot redirect the next request somewhere else.

## What the results mean

| Status     | ReCite reports                                     |
| ---------- | -------------------------------------------------- |
| `200`      | found — `VF003`/`VF004` then compare name and year |
| `300`      | ambiguous — `VF002`                                |
| `404`      | absent — `VF001`                                   |
| `400`      | unchecked, with the reason. **Never** absent.      |
| `429`, 5xx | unchecked, with the reason. **Never** absent.      |

The distinction on the last two rows is the one that matters. A timeout, a
throttle or a rejected token must never read as "CourtListener says this case
does not exist" — that failure mode would be worse than not checking at all.
Anything ReCite could not get an answer for is reported as unchecked, and the
notices under the findings say how many.

And absence is still absence, not proof. No collection of case law is complete;
`VF001` says "does not appear in the CourtListener corpus", not "fabricated",
for the same reason it has always said that of a corpus you supplied.

## Rate limits, and what happens at the ceiling

CourtListener allows **60 citations a minute** per token on the lookup
endpoint. ReCite respects that on its own side rather than discovering it on
theirs: `RateLimiter` holds a rolling one-minute window, because a brief that
blew through the limit would get every subsequent lookup refused — and a
refusal is not an answer.

Two ceilings exist so a long document does not occupy the pane for a quarter of
an hour:

- **120 distinct citations** looked up per check.
- **60 pin cites** quoted per pass.

Whatever is dropped is **reported**, in the notices under the findings. A
silent cap reads exactly like a document that checked out clean, which is the
worst thing a tool in this position can do.

Duplicates cost one request: a brief citing the same case eight times is one
lookup. Answers are remembered for the life of the tab, so applying a fix —
which re-checks the document — does not spend another round of rate limit on
answers that cannot have changed.

## Pin cites and star pagination

`Iqbal, 556 U.S. 662, 678` says "page 678 of volume 556". CourtListener
publishes opinions with **star pagination** — the markers, written `*678`, that
record where the reporter's printed pages began. Finding the marker is what
turns a pin cite into an actual passage.

The rule the code is built around: **no marker, no quotation.** An opinion
without star pagination is common — a slip opinion, a database-only decision, a
court that publishes its own PDFs — and guessing which paragraph is "roughly
page 678" would put a misattributed quotation into somebody's brief. Every path
that cannot find the page returns a note saying so, and the app shows that note
rather than hiding the citation.

Some details worth knowing:

- A cluster can hold a majority, a concurrence and a dissent. Each is tried in
  turn until one carries the page.
- A pin cite to the opinion's own first page is handled specially: that page
  carries no marker, because a marker records where a _new_ page began.
- A multi-page pin cite (`678-80`) is quoted at its first page. `passim` names
  no page and is not quoted.
- Only an unambiguous match is quoted. If a citation matched two decisions,
  quoting the first would attribute words to a case the author may not have
  cited.
- Quotations are trimmed to about 420 characters, at a sentence boundary where
  there is one.

## Where the notes end up

An annotation is plain data — a span, a case name, a page and a passage — which
is what lets the same feature become three different things:

| Surface      | What you get                                                |
| ------------ | ----------------------------------------------------------- |
| Web app      | a panel beside the findings                                 |
| `.docx`      | real Word comments, in the margin next to the citation      |
| `.odt`       | `<office:annotation>`, which LibreOffice shows the same way |
| Word add-in  | Word comments inserted into the open document               |
| Saved report | rows in the JSON and CSV, a section in the Markdown         |

`.txt`, `.md`, `.rtf`, `.html` and `.pdf` have no concept of a comment, and
ReCite does not invent one: saving in those formats gives you the document, not
a marked-up copy of it. The **Save as** note says so when there are comments
that a format cannot carry.

Writing a comment never changes a character of the document. The round trip is
tested both ways — write a `.docx` with comments, read it back with ReCite's own
importer, and the text must be identical.

The Word add-in needs the **WordApi 1.4** requirement set, which is where
`Range.insertComment` arrived. Where it is not available the pane says so and
points at the web app, rather than failing halfway through a document.

## Why it is a separate package

`packages/courtlistener` is the only part of this repository that can open a
connection to another origin, and it is separate so that sentence stays
checkable:

```
core  ← rules  ← engine
  ↑
  └── courtlistener
```

`rules` depends on `core`. It does not depend on `courtlistener`, so a rule
cannot make a request even by accident — nothing in its scope can. The `VF`
family consumes verification results as plain data and has no idea where they
came from, which is why pointing it at a real database needed no change to a
single rule.

## What this costs

Stated plainly, because a document that only lists benefits is not useful.

Before this feature, ReCite's Content Security Policy said `connect-src 'self'`
in the web app and `connect-src 'none'` in the Word pane, and the honest claim
was that **the browser would refuse any cross-origin request at all**. That is
no longer true, and no amount of "but it's opt-in" changes it: a compromised
bundle could now reach one external host.

What survives is narrower and still worth having:

- The browser will refuse a request to **any host but CourtListener**, on both
  surfaces. There is no wildcard and no second origin.
- The Word pane cannot reach even its own origin.
- The client **refuses to exist without a token**, so the default state makes
  no requests at all — which the browser test verifies by intercepting every
  request on a page load.
- The host is written down in exactly **one file**, and a test fails if a
  second file names it.

A firm whose policy forbids any egress from a tool touching client work should
leave this switched off, and can verify that nothing is sent by watching the
network panel. `docs/compliance.md` states the same trade-off in the language a
vendor assessment uses.

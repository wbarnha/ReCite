# Security review notes for law firms

Written for the person at a firm who has to decide whether ReCite may touch a
client document. It answers a standard vendor questionnaire directly, and it is
candid about the two or three places where the honest answer is a boundary
rather than a reassurance.

Every technical claim here is checkable against this repository. Where a claim
is enforced by something other than our good intentions — the browser, a
checksum, a test — that is said, because those are the claims worth relying on.

---

## The short version

**ReCite is not a service. It is a static file that runs in your browser.**

There is no ReCite server. No account, no login, no database. When you check a
document, the text is read into memory in the page, examined, and discarded
when you close the tab or the task pane. It is never transmitted.

That single fact resolves most of a vendor assessment before it starts:

- ReCite is **not a data processor or subprocessor** for your client data,
  because it never receives it.
- There is **no data-sharing agreement to negotiate**, because there is no
  transfer.
- There is **no breach surface at the vendor**, because the vendor holds
  nothing.
- **Privilege is not waived by disclosure to a third party**, because there is
  no disclosure to a third party.

### The one exception, stated up front

ReCite has **one optional feature that contacts an outside service**, and a
reviewer should decide about it deliberately rather than discover it later.

With a [CourtListener](https://www.courtlistener.com/) API token — which the
user must obtain and paste in — ReCite will check that each cited case exists,
and can read the page a pin cite points at. CourtListener is a free public
database of American case law run by the Free Law Project, a non-profit.

**What is sent is a volume, a reporter abbreviation and a page** — `410`,
`U.S.`, `113` — plus the token, plus the identifier of any opinion the user
asked to quote. **Document text is never sent.** The API offers an endpoint
that takes a block of text and finds the citations in it; ReCite does not use
it, and the request body is built by a three-line function with those three
arguments and no branches.

Three things a reviewer can check rather than take on trust:

1. **It is off by default.** The client throws when constructed without a
   token, so an untouched installation makes no external request at all.
2. **The browser enforces the boundary.** `connect-src` names two origins in
   the web app (`'self'` and CourtListener) and one in the Word pane
   (CourtListener alone — not even `'self'`). No wildcard, no third host.
3. **The token is not persisted.** It lives in the tab's memory. No cookie, no
   `localStorage`, no IndexedDB.

If your policy forbids any egress from a tool that touches client work, leave
it switched off; everything else in ReCite still works, and you can confirm the
absence of traffic in a network panel. `docs/courtlistener.md` documents the
integration in full, including what the change to the security policy costs.

## About SOC 2 — read this before asking for a report

**ReCite does not have a SOC 2 report, and cannot have one.** This is not a gap
to be closed later; it is a category difference, and a vendor who told you
otherwise would be misleading you.

SOC 2 is an attestation engagement performed by a licensed CPA firm under AICPA
standards. It examines whether a **service organization's** controls — its
people, its change management, its access reviews, its monitoring — were
suitably designed, and for a Type II, operated effectively over a period of
months. What is being audited is an organization operating a system on behalf
of user entities.

ReCite has no organization, no operations, no personnel with production access,
no production to have access to, and no user entities whose data it holds.
There is nothing for an auditor to scope. A "SOC 2 compliant" open-source static
site is not a thing that exists, and any tool in this category claiming
otherwise is either describing its hosting provider's report as its own or
selling you a badge.

**What is genuinely relevant to your SOC 2:**

1. **GitHub Pages is covered by GitHub's SOC 2.** GitHub, Inc. maintains SOC 2
   Type II coverage; reports are obtainable from GitHub. That covers GitHub's
   controls over the hosting infrastructure serving these files — not ReCite's
   code, which has no controls to audit.
2. **Your own SOC 2, if you have one.** If your firm is audited and maintains a
   vendor inventory, the relevant finding is that ReCite processes no data on
   your behalf and therefore is not a subservice organization. It belongs in
   the inventory as software you run, in the same category as a spell-checker
   or a PDF viewer, not as a service provider.
3. **The Trust Services Criteria that a tool like this can speak to** are mapped
   below — as evidence for _your_ assessment, not as an attestation about ours.

## Trust Services Criteria mapping

Offered as evidence a reviewer can verify, not as an audit result. No CPA firm
has examined any of this.

| Criterion                      | What applies here                                                                                                                                                                                                                                                                                    | How you can check it                                                                                                                    |
| ------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------- |
| **CC6.1** Logical access       | No accounts, no authentication, no authorization surface. There is nothing to gain access to.                                                                                                                                                                                                        | No auth code exists anywhere in the repository.                                                                                         |
| **CC6.6** Boundary protection  | The browser refuses any request to a host the policy does not name. The web app permits `'self'` and `https://www.courtlistener.com`; the Word add-in permits CourtListener alone, not even `'self'`. No wildcards, no third host, and CourtListener is unreachable until the user supplies a token. | View source; check the CSP `<meta>` tag. Enforced by the browser, not by us. A test asserts the exact directive on every build.         |
| **CC6.7** Transmission of data | No document data is transmitted, with or without the CourtListener check enabled: what that sends is the volume, reporter and page of a published citation. The only other requests the app makes are for its own code, from its own origin.                                                         | Open your browser's network panel and check a document. CI intercepts every request on a default page load and fails on any off-origin. |
| **CC7.1** Detection of change  | Every release publishes SHA-256 checksums of every file, plus SHA-384 Subresource Integrity on every script, stylesheet and preloaded module. A tampered asset fails to execute rather than failing to be noticed.                                                                                   | `curl -fsSLO <site>/checksums.sha256 && sha256sum -c checksums.sha256`                                                                  |
| **CC7.2** Monitoring           | CI re-fetches the deployed site after every deploy and verifies it against its own published digests.                                                                                                                                                                                                | `.github/workflows/deploy.yml`, job `verify-published`.                                                                                 |
| **CC8.1** Change management    | Every change is a public commit. Releases are tagged, and the version in the manifest is derived from the tag and re-verified against it during the release build.                                                                                                                                   | Public git history; `.github/workflows/release.yml`.                                                                                    |
| **A1.2** Availability          | Not applicable in the usual sense: a loaded page keeps working with no network at all, minus the optional citation check. There is no service of ours to be unavailable.                                                                                                                             | Load the app, disconnect, keep working.                                                                                                 |
| **C1.1** Confidentiality       | Confidential information is never received, so it is never stored, retained, or disposed of. The one credential the tool handles — a CourtListener API token — is held in page memory and never written anywhere.                                                                                    | The absence of any storage API in the source.                                                                                           |
| **P** Privacy                  | No personal information is collected.                                                                                                                                                                                                                                                                | `privacy.html`, and the absence of analytics or telemetry in the bundle.                                                                |

## Vendor questionnaire

The questions that actually get asked, answered.

**Does the product transmit, store, or process our data outside our
environment?**
No. Processing happens in the browser on the reviewer's own machine. Your
document is not transmitted or stored anywhere else, and that includes files
opened from disk and scanned PDFs, which are read by an OCR engine that also
runs in the page. If a user enables the optional CourtListener check, the
citation components — a volume, a reporter and a page, which identify a
published decision — are sent to that service. Nothing else is.

**Can we disable the CourtListener feature entirely?**
It is disabled unless a user obtains an API token and pastes it in, so for most
firms the answer is "it already is". If you want it gone from the binary, ReCite
is BSD-2-Clause and self-hosting is a supported path: remove the option and
build. The build produces a static `dist/` with no server component to change.

**You mentioned OCR. Where does that run, and what does it send?**
In the browser, and nothing. Optical character recognition for scanned PDFs
uses a WebAssembly engine and an English language model, both published
alongside the application and served from the same origin. The library ReCite
uses would fetch its language models from a third-party CDN by default; that
default is overridden, because otherwise opening a scan would tell a CDN that
someone was doing so. This is verified rather than asserted: a test loads the
built site in a real browser, intercepts every request, and fails if any of
them leaves the origin.

Note the accuracy caveat, which is a different question from the privacy one:
OCR is a machine reading a picture, and it misreads characters. The characters
it confuses are exactly the ones citations are made of. ReCite marks any
document read this way and reports how many pages were recognised.

**Where is data hosted, and in what jurisdiction?**
No data is hosted. The _application files_ are served from GitHub Pages; your
documents never go there.

**Is data encrypted in transit and at rest?**
The question does not apply, which is a stronger answer than "yes". No document
data is in transit or at rest outside your machine. The application files
themselves are served over HTTPS.

**What subprocessors are involved?**
None for your document. Two parties are involved in delivering the software:
GitHub, Inc. (hosts the static files) and Microsoft (serves `office.js` to the
Word add-in, which Office requires be loaded from its CDN rather than bundled).
A third — the Free Law Project, which operates CourtListener — is involved only
if a user enables the citation check, and then receives citation components and
an API token. All three can observe that a request was made: the usual web
server data of IP address, user agent and time. None receives any document
content, because none is sent.

**Can users export documents out of it? Where do those files go?**
To their own disk, and nowhere else. Saving builds the file in the page and
hands it to the browser as a download — `.docx`, `.odt`, `.rtf`, `.pdf`,
`.html`, `.md` or `.txt`, plus a findings report as JSON, CSV or Markdown. No
request is made, because there is nothing to make one to. A saved `.docx` or
`.odt` may carry pincite quotations as document comments; those are passages
from published opinions, not anything derived from your text beyond the
citations already in it.

**What is your data retention and deletion policy?**
There is no retention, so there is nothing to delete. Document text exists in
page memory and is released when the page closes.

**Do you have cyber liability insurance / a named security contact / a DPA?**
No. ReCite is a free open-source project with no corporate entity behind it.
This is a real limitation and you should weigh it: there is no vendor to
indemnify you, no contract, and no support obligation. What there is instead is
that the code is public, the build is reproducible, and the thing you are
trusting is small enough to read.

**Has it been penetration tested?**
Not by a third party. What exists instead: a documented security review
(`docs/security.md`) with the findings and fixes recorded including the ones
that were embarrassing, automated ReDoS testing across every pattern on every
commit, dependency auditing in CI at two thresholds, and a strict CSP. Take
that for what it is — self-assessment, published in full rather than
summarised.

**What happens if the project is abandoned?**
The version you have keeps working; it is a static file with no server
dependency. Under the BSD 2-Clause licence you may fork, vendor, or self-host
it. Self-hosting is a supported path — the manifest generator takes the
deployment origin as a parameter precisely so a firm can serve the add-in from
its own infrastructure and depend on nobody.

## Self-hosting

For a firm that would rather not depend on GitHub Pages at all, or whose policy
requires internal hosting for anything touching client work:

```console
$ RECITE_BASE_URL=https://addins.yourfirm.example/recite/ pnpm build:release
```

That produces a `dist/` directory to serve from any static host, with a
manifest pointing at your origin and checksums covering every file. Office
requires HTTPS. Nothing else changes, because there was never a server
component to move.

## Professional responsibility

Not legal advice — you are better placed to apply these than we are. But the
relevant hooks, since this is a tool for privileged material:

- **ABA Model Rule 1.6(c)** requires reasonable efforts to prevent inadvertent
  or unauthorized disclosure of information relating to the representation. A
  tool that transmits nothing does not create a disclosure to evaluate.
- **ABA Formal Opinion 477R** addresses securing communication of protected
  client information, and turns on whether client information is transmitted to
  third parties. Here it is not.
- **ABA Formal Opinion 512** (2024) addresses generative AI tools and client
  confidentiality. Worth noting explicitly: **ReCite is not a generative AI
  tool.** It is regular expressions and lookup tables. It does not call a
  language model, and there is no model provider receiving prompts. If your
  firm has adopted a policy on AI tools, ReCite is not in scope of it — though
  the reason people want a citation checker in 2026 is precisely the failure
  mode that made _Mata v. Avianca_ famous, and the test fixtures come from that
  filing.

## What ReCite does not protect you from

Stated plainly, because a security document that only lists strengths is not
useful:

- **A clean report is not a verification.** Offline, ReCite proves that
  specific things are wrong. It cannot prove a citation is right, and a
  fabricated citation with a plausible reporter, court and year will pass every
  offline rule. Only checking against an authority source — a list you supply,
  or CourtListener — changes this, and even then absence from a collection is
  not proof of fabrication.
- **It does not read the cited case** and cannot tell you whether it says what
  your brief says it says. It can quote the page a pin cite names, which is a
  much smaller claim: those are the words on that page, put in front of a
  human who then has to judge them.
- **The strong network claim is gone.** ReCite used to guarantee that the
  browser would refuse any cross-origin request at all. With the CourtListener
  feature compiled in, the guarantee is narrower: the browser refuses any
  request to a host other than that one. See `docs/security.md`.
- **It is not a citator.** It will not tell you an authority has been
  overruled.
- **Your browser is still your browser.** ReCite's guarantees are about ReCite.
  A compromised machine, a malicious extension with page access, or a hostile
  browser is outside what any in-page tool can defend against.
- **There is no warranty.** BSD 2-Clause, as-is. See `terms.html`.

## Verifying this document is not just words

The claims above are meant to be checked, not believed:

```console
# What the live site actually serves matches its published digests
$ curl -fsSLO https://wbarnha.github.io/ReCite/checksums.sha256
$ sha256sum -c checksums.sha256

# No network calls, no storage, in the shipped bundle
$ curl -fsSL https://wbarnha.github.io/ReCite/ | grep -o "connect-src [^;]*"
```

And in the source: search the repository for `XMLHttpRequest`, `localStorage`,
`sessionStorage`, `indexedDB`, or `navigator.sendBeacon` — there are none.
Search for `fetch` and you will find exactly three call sites, each with a
written justification in `tools/test/privacy-claims.test.ts`, which fails the
build if a fourth appears.

See also [`security.md`](security.md) for the threat model and the review
findings, [`courtlistener.md`](courtlistener.md) for the one outbound feature
in full, and [`appsource.md`](appsource.md) for the Microsoft submission.

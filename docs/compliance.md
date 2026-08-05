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

There is no ReCite server. No account, no login, no database, no API. When you
check a document, the text is read into memory in the page, examined, and
discarded when you close the tab or the task pane. It is never transmitted.

That single fact resolves most of a vendor assessment before it starts:

- ReCite is **not a data processor or subprocessor** for your client data,
  because it never receives it.
- There is **no data-sharing agreement to negotiate**, because there is no
  transfer.
- There is **no breach surface at the vendor**, because the vendor holds
  nothing.
- **Privilege is not waived by disclosure to a third party**, because there is
  no disclosure to a third party.

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

| Criterion                      | What applies here                                                                                                                                                                                                                                             | How you can check it                                                                                                                      |
| ------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------- |
| **CC6.1** Logical access       | No accounts, no authentication, no authorization surface. There is nothing to gain access to.                                                                                                                                                                 | No auth code exists anywhere in the repository.                                                                                           |
| **CC6.6** Boundary protection  | The browser refuses any cross-origin request from either page. The Word add-in sets `connect-src 'none'`; the web app sets `connect-src 'self'`, because in-browser OCR has to load a WebAssembly engine from this origin. Neither permits any external host. | View source; check the CSP `<meta>` tag. Enforced by the browser, not by us. A browser test asserts it on every build.                    |
| **CC6.7** Transmission of data | No document data is transmitted. There is no endpoint to transmit to. The only requests the app makes are for its own code, from its own origin.                                                                                                              | Open your browser's network panel and check a document. CI does the same with request interception and fails if anything goes off-origin. |
| **CC7.1** Detection of change  | Every release publishes SHA-256 checksums of every file, plus SHA-384 Subresource Integrity on every script, stylesheet and preloaded module. A tampered asset fails to execute rather than failing to be noticed.                                            | `curl -fsSLO <site>/checksums.sha256 && sha256sum -c checksums.sha256`                                                                    |
| **CC7.2** Monitoring           | CI re-fetches the deployed site after every deploy and verifies it against its own published digests.                                                                                                                                                         | `.github/workflows/deploy.yml`, job `verify-published`.                                                                                   |
| **CC8.1** Change management    | Every change is a public commit. Releases are tagged, and the version in the manifest is derived from the tag and re-verified against it during the release build.                                                                                            | Public git history; `.github/workflows/release.yml`.                                                                                      |
| **A1.2** Availability          | Not applicable in the usual sense: a loaded page keeps working with no network at all. There is no service to be unavailable.                                                                                                                                 | Load the app, disconnect, keep working.                                                                                                   |
| **C1.1** Confidentiality       | Confidential information is never received, so it is never stored, retained, or disposed of.                                                                                                                                                                  | The absence of any storage API in the source.                                                                                             |
| **P** Privacy                  | No personal information is collected.                                                                                                                                                                                                                         | `privacy.html`, and the absence of analytics or telemetry in the bundle.                                                                  |

## Vendor questionnaire

The questions that actually get asked, answered.

**Does the product transmit, store, or process our data outside our
environment?**
No. Processing happens in the browser on the reviewer's own machine. Nothing is
transmitted or stored anywhere else. That includes files opened from disk and
scanned PDFs, which are read by an OCR engine that also runs in the page.

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
None for your data. Two parties are involved in delivering the software:
GitHub, Inc. (hosts the static files) and Microsoft (serves `office.js` to the
Word add-in, which Office requires be loaded from its CDN rather than bundled).
Both can observe that a request for the application was made — the usual web
server data: IP address, user agent, time. Neither receives any document
content, because none is sent.

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
  offline rule. Only checking against an authority list you supply changes
  this.
- **It does not read the cited case** and cannot tell you whether it says what
  your brief says it says.
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

And in the source: search the repository for `fetch`, `XMLHttpRequest`,
`localStorage`, `sessionStorage`, `indexedDB`, or `navigator.sendBeacon`. The
only external request in the entire application is `office.js`, and it appears
only in the Word task pane.

See also [`security.md`](security.md) for the threat model and the review
findings, and [`appsource.md`](appsource.md) for the Microsoft submission.

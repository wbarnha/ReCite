/**
 * The text of ReCite's static pages.
 *
 * AppSource requires a privacy policy and terms of use at stable public URLs,
 * and a support URL. These are those pages.
 *
 * Everything here describes behaviour that is true of the code in this
 * repository and checkable against it. Where a third party can observe
 * something — GitHub's request logs, Microsoft's CDN — it is stated rather
 * than glossed, because a privacy policy that overclaims is worse than one
 * that admits a boundary.
 */

import type { Page } from "./chrome.js";

const REPO = "https://github.com/wbarnha/ReCite";

const privacy: Page = {
  file: "privacy.html",
  title: "ReCite — Privacy Policy",
  heading: "Privacy Policy",
  lede: `ReCite does not collect, store, transmit, or have any access to the
    documents you check. Checking runs entirely inside your browser, or inside
    your copy of Microsoft Word. There is no ReCite server for your text to be
    sent to.`,
  body: `
    <h2>What ReCite does with your document</h2>
    <p>
      Nothing leaves the page. When you paste text into the web app, or open the
      task pane in Word, the document is read into memory, checked, and
      discarded when you close the tab or pane. It is never uploaded, never
      written to disk by ReCite, and never shared with anyone.
    </p>
    <p>
      ReCite stores nothing between sessions: no cookies, no
      <code>localStorage</code>, no <code>sessionStorage</code>, no IndexedDB.
      Closing the page ends everything.
    </p>
    <p>
      The application makes no network requests of its own while it runs. Its
      Content Security Policy sets <code>connect-src 'none'</code>, so the
      browser itself refuses to open a connection. That is a restriction
      enforced by your browser, not a promise made by us.
    </p>

    <h2>What we collect</h2>
    <p>
      No personal information. There are no accounts, no sign-in, no analytics,
      no telemetry, no advertising and no third-party trackers of any kind. We
      do not build profiles, and we have nothing to sell or disclose because we
      receive nothing in the first place.
    </p>

    <h2>What third parties can see</h2>
    <p>
      ReCite is a static website. Delivering it to you involves two other
      companies, and we would rather state plainly what each can observe than
      imply the answer is nothing:
    </p>
    <div class="wrap">
    <table>
      <thead>
        <tr><th>Party</th><th>What they receive</th><th>Your document?</th></tr>
      </thead>
      <tbody>
        <tr>
          <td>GitHub Pages (GitHub, Inc.) — hosts the files</td>
          <td>
            Ordinary web server request data when you load the page: IP address,
            browser user agent, which file was requested, and when. This is
            GitHub's logging, under
            <a href="https://docs.github.com/site-policy/privacy-policies/github-privacy-statement">GitHub's
            Privacy Statement</a>. We do not receive it, cannot query it and
            have no access to it.
          </td>
          <td>No</td>
        </tr>
        <tr>
          <td>Microsoft — serves <code>office.js</code>, in the Word add-in only</td>
          <td>
            A request for the Office JavaScript library, which Microsoft
            requires be loaded from its own content delivery network rather than
            bundled. The same ordinary request data as above.
          </td>
          <td>No</td>
        </tr>
      </tbody>
    </table>
    </div>
    <p>
      Both can see that <em>someone</em> loaded ReCite. Neither sees a word of
      what you check with it. The web app does not load
      <code>office.js</code> at all — that request happens only inside
      Microsoft Word.
    </p>

    <h2>Your authority list</h2>
    <p>
      ReCite can check citations against a list of authorities you supply. That
      list is handled exactly as the document is: in memory, never transmitted,
      discarded when you close the page.
    </p>

    <h2>Legal professional privilege</h2>
    <p>
      ReCite is built for people who work with privileged and confidential
      material. Because no document text is transmitted, using ReCite does not
      disclose your document to any third party, and does not create a
      processor or subprocessor relationship with anyone. See the
      <a href="${REPO}/blob/main/docs/compliance.md">compliance notes</a> for
      the detail a firm's security review will want.
    </p>

    <h2>Children</h2>
    <p>
      ReCite is a professional writing tool, is not directed at children, and
      collects no information from anyone, including children.
    </p>

    <h2>Changes</h2>
    <p>
      A revised policy will be published here with a new date. Every version is
      recorded in the project's public commit history, so any change can be
      inspected and dated independently of this page.
    </p>

    <h2>Contact</h2>
    <p>
      ReCite is an open-source project. Questions and reports go to
      <a href="${REPO}">${REPO.replace("https://", "")}</a>.
    </p>
`,
};

const terms: Page = {
  file: "terms.html",
  title: "ReCite — Terms of Use",
  heading: "Terms of Use",
  lede: `ReCite is free, open-source software provided as-is. It finds specific,
    checkable mistakes in legal citations. It is not a lawyer, it is not legal
    advice, and a clean report is not a guarantee that a citation is correct.`,
  body: `
    <h2>Licence</h2>
    <p>
      ReCite is licensed under the BSD 2-Clause Licence. The full text is in the
      <a href="${REPO}/blob/main/LICENSE">repository</a>, and it governs your
      use of the software. You may use, copy, modify and redistribute it under
      those terms, including commercially.
    </p>

    <h2>No warranty</h2>
    <p>
      As stated in the licence, the software is provided "as is", without
      warranty of any kind, express or implied, including the warranties of
      merchantability and fitness for a particular purpose. The authors and
      contributors are not liable for any claim, damages or other liability
      arising from the software or its use.
    </p>

    <h2>What ReCite does not do</h2>
    <div class="panel">
      <p>
        <strong>A clean run is not a guarantee.</strong> ReCite proves that
        specific things are wrong. It cannot prove that a citation is right.
      </p>
    </div>
    <ul>
      <li>
        It does not verify that a cited case exists, unless you supply an
        authority list to check against. A fabricated citation with a plausible
        reporter, court and year will pass every offline rule.
      </li>
      <li>
        It does not read the cited case, and cannot tell you whether the case
        says what your brief says it says.
      </li>
      <li>
        It does not check whether an authority is still good law. Nothing here
        is a substitute for a citator.
      </li>
      <li>
        Its reporter and court tables are not exhaustive, and an unrecognised
        reporter is reported as unknown rather than as wrong.
      </li>
    </ul>

    <h2>Your professional obligations are yours</h2>
    <p>
      You remain responsible for every citation you file. ReCite is a tool for
      catching mistakes, in the way a spell-checker is; the duty of candour to
      the tribunal, and the duty of competence, remain entirely yours. Nothing
      produced by this software is legal advice, and using it creates no
      attorney-client relationship with anyone.
    </p>

    <h2>Automatic fixes</h2>
    <p>
      ReCite applies only corrections it classifies as safe — those that change
      how a citation is spelled without changing which authority it points to.
      Anything that would change the case, court or year is held back behind an
      explicit opt-in. Review every change before you file. You accept a
      correction; ReCite does not accept it for you.
    </p>

    <h2>Availability</h2>
    <p>
      The web app is published on GitHub Pages and is offered without any
      undertaking as to availability. Because everything runs in your browser,
      a page already loaded keeps working without a network connection.
    </p>

    <h2>Changes</h2>
    <p>
      Revised terms will be published here with a new date, and every version is
      recorded in the project's public commit history.
    </p>
`,
};

const support: Page = {
  file: "support.html",
  title: "ReCite — Support",
  heading: "Support",
  lede: `ReCite is a free, open-source project. Support is through its public
    issue tracker, where questions and answers stay visible to everyone.`,
  body: `
    <h2>Getting help</h2>
    <p>
      Open an issue at
      <a href="${REPO}/issues">${REPO.replace("https://", "")}/issues</a>.
      Please include what you expected, what happened, and the citation text
      involved.
    </p>
    <div class="panel">
      <p>
        <strong>Do not paste privileged or confidential material into an
        issue.</strong> The tracker is public. Citations reproduced from a
        published opinion are fine; text from a client's draft is not. If a
        problem only reproduces on a confidential document, describe the shape
        of the citation rather than quoting it.
      </p>
    </div>

    <h2>Reporting a security problem</h2>
    <p>
      Open an issue, say in the title that it is a security report, and leave
      the details out until someone can reply. See the project's
      <a href="${REPO}/blob/main/docs/security.md">security notes</a>.
    </p>

    <h2>The Word add-in</h2>
    <p>
      Installation, permissions and troubleshooting are documented in
      <a href="${REPO}/blob/main/docs/word-add-in.md">docs/word-add-in.md</a>.
      One thing worth knowing in advance: Word caches add-in manifests
      aggressively, so after an update you may need to remove and re-add the
      add-in before the pane changes.
    </p>

    <h2>Verifying what you are running</h2>
    <p>
      Every release publishes SHA-256 checksums of every file, and the pages
      carry Subresource Integrity attributes so a tampered asset fails to
      execute rather than failing to be noticed. To check the live site
      yourself:
    </p>
    <div class="panel">
      <code>curl -fsSLO https://wbarnha.github.io/ReCite/checksums.sha256</code><br />
      <code>sha256sum -c checksums.sha256</code>
    </div>

    <h2>Security and compliance review</h2>
    <p>
      If your firm's IT or risk team needs to assess ReCite before you use it on
      client work, the
      <a href="${REPO}/blob/main/docs/compliance.md">compliance notes</a> are
      written for exactly that, and answer the standard vendor questionnaire
      directly.
    </p>
`,
};

export const PAGES: readonly Page[] = [privacy, terms, support];

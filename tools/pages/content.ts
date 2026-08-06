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
    documents you check — including files you open and scanned PDFs it reads
    with OCR. Everything runs inside your browser, or inside your copy of
    Microsoft Word. There is no ReCite server for your text to be sent to. One
    optional feature contacts one outside service; it is described in full
    below, and it is off unless you switch it on.`,
  body: `
    <h2>What ReCite does with your document</h2>
    <p>
      Your document does not leave the page. When you paste text, open a file,
      or use the task pane in Word, it is read into memory, checked, and
      discarded when you close the tab or pane. It is never uploaded, never
      written to disk by ReCite, and never shared with anyone. That is true
      whether or not you switch on the CourtListener check described below,
      which sends the numbers and abbreviation of a citation and no part of
      your text.
    </p>
    <p>
      That includes files you open. A Word document, PDF, RTF or OpenDocument
      file is read by your browser from your own disk — there is no upload step,
      because there is nowhere to upload to. Scanned PDFs are read by
      optical character recognition running inside the page, on your machine.
    </p>
    <p>
      ReCite stores nothing between sessions: no cookies, no
      <code>localStorage</code>, no <code>sessionStorage</code>, no IndexedDB.
      Closing the page ends everything.
    </p>
    <p>
      The web app is allowed to load its own code from its own address, and to
      reach exactly one other host: CourtListener, and only when you have
      supplied an API token. Its Content Security Policy sets
      <code>connect-src 'self' https://www.courtlistener.com</code>, so your
      browser refuses every request it might make to anywhere else. That is a
      restriction enforced by the browser, not a promise made by us. The Word
      add-in is stricter still — <code>connect-src
      https://www.courtlistener.com</code>, without even
      <code>'self'</code> — because Word hands it the document directly and it
      has nothing of its own to load.
    </p>
    <p>
      The one thing the web app does load from its own address is the OCR
      engine, and only if you open a scanned PDF. Reading a scan means
      recognising characters in an image, which needs a recognition engine and
      a language model. Both are published alongside this page and are served
      from here. The library ReCite uses would fetch its language models from a
      third-party CDN by default; that default is overridden, precisely so that
      opening a scan does not tell anyone else that you did.
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
      organisations, and one optional feature involves a third. We would rather
      state plainly what each can observe than imply the answer is nothing:
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
        <tr>
          <td>
            CourtListener (Free Law Project) — <strong>only if you supply an API
            token</strong>
          </td>
          <td>
            The volume, reporter and page of each citation you ask it to check,
            your API token, and the identifier of any opinion you ask it to
            quote. Plus the same ordinary request data as above.
          </td>
          <td>No</td>
        </tr>
      </tbody>
    </table>
    </div>
    <p>
      All three can see that <em>someone</em> made a request. None of them sees
      a word of your document. The web app does not load
      <code>office.js</code> at all — that request happens only inside
      Microsoft Word — and neither surface contacts CourtListener until you
      have pasted a token.
    </p>

    <h2>Your authority list</h2>
    <p>
      ReCite can check citations against a list of authorities you supply. That
      list is handled exactly as the document is: in memory, never transmitted,
      discarded when you close the page.
    </p>

    <h2>Checking citations against CourtListener</h2>
    <div class="panel">
      <p>
        <strong>This is the only feature in ReCite that contacts anyone, and it
        is off until you turn it on.</strong> It needs an API token from
        CourtListener, which you have to obtain and paste in. Without one, no
        request is made — the code refuses to build a client at all.
      </p>
    </div>
    <p>
      A citation can be perfectly formed and refer to no case whatsoever, and
      no amount of offline checking will catch that. Proving a case exists
      means looking it up. CourtListener is a free public database of American
      case law, run by the
      <a href="https://free.law/">Free Law Project</a>, a non-profit; ReCite
      can ask it whether a citation matches a decision, and can read the page a
      pin cite points at so the passage can be attached to your document as a
      comment.
    </p>
    <p><strong>What is sent, when the feature is on:</strong></p>
    <ul>
      <li>
        The <em>components of a citation</em> — a volume, a reporter
        abbreviation and a page. For <code>410 U.S. 113</code> that is
        <code>volume=410&amp;reporter=U.S.&amp;page=113</code>, and nothing
        else. You can watch this in your browser's network panel.
      </li>
      <li>
        The <em>identifier of an opinion</em> whose text you asked ReCite to
        quote, which comes from CourtListener's own answer to the citation
        above.
      </li>
      <li>
        Your <em>API token</em>, which is how CourtListener knows the request
        is yours.
      </li>
    </ul>
    <p><strong>What is never sent:</strong> your document. Not a sentence, not
      a paragraph, not a case name, not a heading. CourtListener's API offers
      an endpoint that takes a block of text and finds the citations in it —
      which would be fewer requests, and would mean posting your brief to a
      third party. ReCite does not use it, and there is no code path by which
      it could: the request body is built by one short function that takes a
      volume, a reporter and a page as its arguments.
    </p>
    <p>
      Your token is held in the tab's memory and written nowhere — no cookie,
      no <code>localStorage</code>, no IndexedDB. Closing the page forgets it,
      and you will paste it again next time. That is deliberate: a token is a
      credential, and a credential in browser storage outlives the session that
      needed it.
    </p>
    <p>
      CourtListener will see the requests you make, subject to
      <a href="https://www.courtlistener.com/terms/">their terms and privacy
      policy</a>. What they can infer is that someone holding your token
      checked those citations. If the fact that you are researching a
      particular authority is itself sensitive, that is a reason not to switch
      this on — and it stays off by default for exactly that reason.
    </p>
    <p>
      <strong>A quotation is not a verification.</strong> ReCite reads the page
      a pin cite names, using the star pagination in CourtListener's copy of
      the opinion. Where that page is not marked, it says so rather than
      quoting the nearest paragraph. Either way, check it against the reporter
      before you rely on it.
    </p>

    <h2>Legal professional privilege</h2>
    <p>
      ReCite is built for people who work with privileged and confidential
      material. Because no document text is transmitted, using ReCite does not
      disclose your document to any third party, and does not create a
      processor or subprocessor relationship with anyone. That holds with the
      CourtListener check switched on as well: a volume, a reporter and a page
      identify a published decision, not your client. Whether the <em>pattern</em>
      of authorities you look up is itself sensitive is a judgement only you can
      make, which is why the feature is opt-in and says what it sends at the
      point where you switch it on. See the
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
        It does not verify that a cited case exists, unless you point it at
        something that knows — an authority list you supply, or CourtListener
        with an API token. A fabricated citation with a plausible reporter,
        court and year will pass every offline rule.
      </li>
      <li>
        A citation that CourtListener does <em>not</em> hold is not thereby
        proved false. No collection of case law is complete, and ReCite reports
        absence as absence rather than as fabrication.
      </li>
      <li>
        It does not read the cited case, and cannot tell you whether the case
        says what your brief says it says. It <em>can</em> quote the page a pin
        cite points at, which is a different and much smaller claim: those are
        the words printed on that page, put in front of you so that you can
        judge whether they support the sentence citing them. Where the page is
        not marked in the source ReCite has, it says so instead of quoting
        something near it.
      </li>
      <li>
        It does not check whether an authority is still good law. Nothing here
        is a substitute for a citator.
      </li>
      <li>
        Its reporter and court tables are not exhaustive, and an unrecognised
        reporter is reported as unknown rather than as wrong.
      </li>
      <li>
        <strong>Text read from a scanned PDF by OCR is a machine's reading of
        an image, not the document itself.</strong> Optical character
        recognition misreads characters, and the ones it confuses most —
        <code>1</code> for <code>l</code>, <code>0</code> for <code>O</code>,
        <code>5</code> for <code>S</code> — are the ones citations are made of.
        A volume, page or year recovered this way may be wrong even when it
        looks right. ReCite marks a document read this way and says how many
        pages it recognised; check anything it reports against the original.
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

const tutorial: Page = {
  file: "tutorial.html",
  title: "ReCite — Walkthrough",
  heading: "A walkthrough, with a real filing",
  lede: `Ten minutes with the document that made citation checking a live issue:
    the affirmation from <em>Mata v. Avianca</em>, the brief that cited six cases
    which did not exist.`,
  body: `
    <h2>The document</h2>
    <p>
      In 2023 a lawyer in the Southern District of New York filed a brief citing
      six decisions that had never been decided. They had been produced by a
      chatbot, and they were plausible on their face — real reporters, real
      courts, years that fit. Opposing counsel could not find them. Neither
      could the judge.
    </p>
    <p>
      The affirmation the court then asked for is published here, and it is what
      this walkthrough uses:
    </p>
    <div class="panel">
      <p>
        <strong><a href="mata-v-avianca-filing.pdf" download>Download the filing (PDF, 441&nbsp;KB)</a></strong><br />
        <em>Mata v. Avianca, Inc.</em>, No. 1:22-cv-01461 (PKC) (S.D.N.Y. filed
        Mar. 1, 2023). A public court filing, from the public docket.
      </p>
    </div>
    <p>
      It is a useful test for a reason beyond its history: eleven pages, part
      typed and part scanned exhibit, so opening it exercises both ways ReCite
      reads a PDF.
    </p>

    <h2>1. Open it</h2>
    <p>
      Go to <a href="./">the app</a> and press <strong>Try the example
      filing</strong> — or download the PDF above and drag it onto the page.
      Both do the same thing; the button just saves you a step.
    </p>
    <p>
      It takes roughly forty seconds. Most of that is optical character
      recognition: several pages have no text layer, so there is nothing to read
      and the words have to be recognised from the image. The status line counts
      pages as it goes.
    </p>
    <div class="panel">
      <p>
        <strong>Nothing is uploaded.</strong> The file is read by your browser,
        from your own disk, and the recognition runs in the page. There is no
        ReCite server. See the <a href="privacy.html">privacy policy</a> for how
        that is enforced rather than merely promised.
      </p>
    </div>

    <h2>2. Look at it</h2>
    <p>
      Because a file was opened rather than pasted, the document arrives as a
      <strong>page</strong> rather than as a text box: paragraphs, serif type,
      and room in the margin for the notes that come later. You can edit it —
      type, cut, paste, and use <strong>B</strong>, <strong>I</strong> and
      <strong>U</strong> or <kbd>Ctrl</kbd>+B/I/U for emphasis. Anything you
      style here is kept when you save.
    </p>
    <p>
      Paste into ReCite instead of opening a file and you get the plain text
      box, which is the right control for checking one citation. A checkbox
      moves between the two, so neither is a trap.
    </p>

    <h2>3. Read the warning</h2>
    <p>
      When it finishes, the app says the document was <em>partly read by
      OCR</em>. That warning is not boilerplate. Optical character recognition
      guesses at characters, and the characters it confuses —
      <code>1</code> for <code>l</code>, <code>0</code> for <code>O</code>,
      <code>5</code> for <code>S</code> — are the ones citations are made of.
      You will see the damage in the text box: <code>Affirma tion</code>,
      <code>Opposi T I on</code>.
    </p>
    <p>
      So treat what follows as a list of things to look at, not a list of
      findings to trust. That is true of ReCite generally and doubly true of a
      scan.
    </p>

    <h2>4. Check it</h2>
    <p>
      Press <strong>Check citations</strong>. ReCite finds about
      <strong>25 citations</strong> and reports a handful of problems —
      inconsistent reporter abbreviations, a short form with nothing to attach
      to, a page range written the long way.
    </p>
    <p>
      Each one is marked in the document where it is, and listed beside it.
      Click a finding to jump to it; each names the rule that fired, so you can
      look it up rather than take it on faith.
    </p>

    <h2>5. Notice what it does <em>not</em> say</h2>
    <div class="panel">
      <p>
        <strong>ReCite does not report that these cases do not exist.</strong>
        This is the most important thing on this page.
      </p>
    </div>
    <p>
      <em>Varghese v. China Southern Airlines</em> is cited in this filing as
      925 F.3d 1339 (11th Cir. 2019). It is not a case. But the volume is
      plausible, the Federal Reporter's third series was running in 2019, and the
      Eleventh Circuit publishes there. Every offline check passes, because
      every offline check is about form.
    </p>
    <p>
      A fabricated citation with a well-chosen reporter, court and year will
      pass every rule ReCite has. Proving a case exists means looking it up, and
      that means a source of truth ReCite does not carry.
    </p>

    <h2>6. Check that the cases exist</h2>
    <p>
      This is the part that catches a fabrication. Under <strong>Verify cases
      against</strong> there are two ways to do it, and the difference between
      them is the difference between a prompt and a finding.
    </p>
    <p>
      <strong>The five-case sample list</strong> shows the mechanism. Every
      citation not in the list is reported as unverified — including the
      invented ones, but also including nearly everything else, because the list
      holds five cases. That is the honest behaviour: it is a prompt to check by
      hand, not evidence a case is fake.
    </p>
    <p>
      <strong>CourtListener</strong> is the version that is actually useful. It
      is a free public database of American case law run by the Free Law
      Project, and with an
      <a href="https://www.courtlistener.com/help/api/rest/">API token</a>
      pasted into the box, ReCite looks up every citation in the document. On
      this filing the six fabricated cases come back <em>not found</em> — which
      is the answer nothing else on this page could give you.
    </p>
    <div class="panel">
      <p>
        <strong>This is the one thing ReCite sends anywhere.</strong> What goes
        to CourtListener is the volume, the reporter and the page —
        <code>925</code>, <code>F.3d</code>, <code>1339</code> — and your token.
        Not a word of the document. See the
        <a href="privacy.html">privacy policy</a>, which sets out exactly what
        is sent and how the browser is configured to refuse anything else.
      </p>
    </div>
    <p>
      Absence from CourtListener is still absence, not proof: no collection is
      complete. But a citation that a database of millions of decisions has
      never heard of is worth ten minutes of your attention, and that is the
      whole job.
    </p>

    <h2>7. Pull the pincites</h2>
    <p>
      With CourtListener on, <strong>Pull pincites</strong> reads the page each
      pin cite points at and shows you the passage. <em>Miller</em> at 371 is no
      longer a page number you have to trust — it is a sentence you can read
      next to the proposition it is cited for.
    </p>
    <p>
      They appear in the margin of the page, next to the citation each one is
      about — and are written into the saved <code>.docx</code> or
      <code>.odt</code> as real comments, so they survive being emailed to
      somebody who has never heard of this tool. In the Word add-in they become
      Word comments in the open document.
    </p>
    <p>
      Where a page is not marked in CourtListener's copy of the opinion, ReCite
      says so and quotes nothing. A quotation attributed to the wrong page is
      worse than no quotation, and it is the kind of wrong that survives all the
      way into a filing.
    </p>

    <h2>8. Fix what is safe</h2>
    <p>
      <strong>Fix</strong> applies only corrections that change how a citation
      is spelled, never which authority it points at: spacing, abbreviation,
      the form of a page range. Anything that would change a case, a court or a
      year is held back behind a checkbox, because a confidently wrong citation
      is worse than a visibly broken one.
    </p>
    <p>
      Review each change. You accept a correction; ReCite does not accept it for
      you.
    </p>

    <h2>9. Save it</h2>
    <p>
      Choose a format under <strong>Save as</strong> and press
      <strong>Download</strong>. The document comes back as
      <code>.docx</code>, <code>.odt</code>, <code>.rtf</code>,
      <code>.pdf</code>, <code>.html</code>, <code>.md</code> or
      <code>.txt</code>, with any emphasis you applied and any quotations you
      pulled. The PDF is the exception on both counts: it is written directly,
      in Helvetica, with no second font to switch to and no notion of a
      comment.
    </p>
    <p>
      You can also save the <strong>findings report</strong> — as JSON for
      another tool, CSV for a spreadsheet, or Markdown to paste into a memo. The
      report records which build produced it, which reporter table it used, and
      what the citations were verified against, so a note in a file can be
      traced back to an exact commit and an exact source.
    </p>
    <p>
      Everything is written in the page and handed to your browser as a
      download. Again: no upload, no server.
    </p>

    <h2>What to take from it</h2>
    <ul>
      <li>
        ReCite catches what is <strong>checkable offline</strong>: impossible
        reporter and year pairings, courts that did not exist, inconsistent
        abbreviations, short forms pointing at nothing.
      </li>
      <li>
        It cannot catch a <strong>fabrication</strong> without something that
        knows what exists. Point it at CourtListener, or at your firm's own
        list of authorities.
      </li>
      <li>
        <strong>A clean run is not a verification.</strong> It proves specific
        things are wrong. It cannot prove a citation is right, and it is not a
        citator: it will not tell you an authority has been overruled.
      </li>
    </ul>
    <p>
      Which is the whole lesson of <em>Mata</em>, really. The problem was never
      that the citations looked wrong.
    </p>
`,
};

export const PAGES: readonly Page[] = [tutorial, privacy, terms, support];

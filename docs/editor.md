# The document editor

A textarea is the right control for pasting a paragraph and checking one
citation. It is the wrong one for a brief.

So when a **file** is opened — dragged in, chosen from the picker, or the
example filing — the document becomes a page: serif type, paragraph structure,
the findings marked where they are in the text, and the pincite quotations in a
margin beside the citations they belong to. Paste into the box and nothing
changes; the box is still there, and it is still what you get.

That is the whole rule. A file becomes a document; text pasted stays text.

## What it does

|                    |                                                                  |
| ------------------ | ---------------------------------------------------------------- |
| Editing            | type, cut, paste, undo — it is a `contenteditable`, not a viewer |
| Formatting         | bold, italic, underline, by toolbar or <kbd>Ctrl</kbd>+B/I/U     |
| Findings           | marked in the text; click one to jump to it                      |
| Fixes              | applied in place, keeping the formatting around them             |
| Pincite quotations | in the margin, anchored to the citation, clickable               |
| Saving             | the marks go into `.docx`, `.odt`, `.rtf` and `.html`            |

**ReCite still does not read the formatting of a document you open.** It works
on the text of citations, and a `.docx` is imported for its prose exactly as it
always was. What is new is that the formatting _you_ apply in the editor is
kept, and is written out when you save — because an editor that silently
un-bolded a case name on save would be worse than no editor at all.

There is a **Edit as plain text instead** checkbox. Neither surface is a trap;
switching back and forth keeps the text and drops the marks, and says so.

## How it is built

No rich-text library. React and the two PDF packages are the whole runtime
dependency tree, and `docs/security.md` explains why that number is worth
keeping small. Three decisions do the work instead.

### The text is the document

`@recite/core` takes a string. A `Span` is a pair of character offsets into
that string, and a `Correction` is a replacement for one of them. None of that
changed, and none of it should: the rule set has no business knowing that
something on screen is bold.

So `RichDocument` is defined by its relationship to the plain text rather than
the other way round:

- `richToText(document)` is the string the engine sees.
- A paragraph is one line of that string. The newline between two paragraphs
  counts as one character, exactly as it does in a textarea.
- `replaceRange(document, start, end, text)` edits by those same offsets.

That invariant — **the same offset means the same thing in both** — is what
lets a finding computed against a string light up the right words on screen,
and a fix aimed at `[36, 48)` land on the right citation. `apps/web/test/document.test.ts`
is mostly about holding it.

Which corrections are _allowed_ is still decided by `applyCorrections` in
`@recite/core`, against the plain text, so a formatted document and a plain one
accept and refuse exactly the same set. Two rules fighting over one citation
still produce a reported refusal rather than nonsense.

### Marks live in the model, not in `execCommand`

`document.execCommand("bold")` is deprecated, and its output differs by
browser: `<b>` in one, a `<span style="font-weight: 700">` in another,
sometimes both in the same document. Bolding a selection here instead reads the
DOM into a `RichDocument`, toggles the mark over an offset range, and renders
the result back.

Deterministic, testable in Node without a DOM, and it follows the rule a word
processor uses: if every character in the selection already carries the mark,
the command removes it; otherwise it adds it. Anything else makes the button
feel broken on a mixed selection.

The reader still has to cope with whatever the browser produced by other
means — a paste, an autocorrect — so `document/dom.ts` asks about computed
meaning rather than matching tag names, and normalises everything back to the
three marks ReCite has.

### Findings are painted, not wrapped

The obvious way to underline a bad citation inside a `contenteditable` is to
wrap it in a `<span>`. That is also the wrong way: it puts ReCite's own markup
into the thing being edited, moves the caret every time the check re-runs, and
ends up in the saved file.

The **CSS Custom Highlight API** exists for this. Ranges are registered with
the browser and painted through `::highlight(...)`, and the DOM is untouched —
so the text you select, copy and save is exactly what you typed. A browser test
asserts both halves: that highlights are registered after a check, and that the
editor's own HTML contains no ReCite markup.

Where the API is missing the highlights simply do not appear, and the editor
says so. That is a deliberate choice about what degrades: the findings panel
still lists everything with a line and column, **Show** still selects the span,
and nothing that decides whether a citation is wrong depends on any of it.

### Blank lines, and what they cost to get wrong

An empty paragraph is rendered `<p><br></p>`: an empty `<p>` collapses to
nothing and the caret cannot reach it, so the filler `<br>` is what makes a
blank line a line you can click into.

The reader has to know that filler is not content, and getting it wrong has
been expensive twice. Counting the filler as a line read one blank line as two,
and the damage from a single character of drift is worth recording, because it
is not obvious from the bug:

- Every offset below the first blank line was out by one, so `rangeFor` refused
  to resolve any of them — **findings painted nothing** below that point, and a
  jump landed nowhere.
- The text the editor derived from its own DOM had **doubled blank lines**, so
  a document saved out of the editor came back with gaps twice the size, and
  doubled again each time it went round.

The rule is that a `<br>` ending its parent is filler — the enclosing block
emits that paragraph as it closes — and only a `<br>` with something after it
is a line of its own.

Fixing that exposed a second bug underneath it. A guard at the end of `read`
dropped a trailing empty paragraph, on the grounds that the walk left one
behind — which it did, but only because of the doubling above. With the count
correct there is no artefact to drop, so the guard could only ever fire on a
blank line somebody had actually typed. It ate the one at the end of every
document that had one.

Both halves are pinned by browser tests, and the obvious test does not do the
job: opening a file seeds the editor and hands the same string straight back to
the panels beside it, so saving immediately never calls `read` and passes
however broken the reader is. The test that earns its place applies a fix
first — that reads the page, edits the model and renders it again, which is the
route a user actually takes — and then compares the saved bytes.

### The DOM is the document

While the editor is open, the `contenteditable` holds the document and React
holds a derived copy of the text for the panels beside it. That is the same
arrangement the textarea has always had — `BrowserHost` reads the live value,
not a stale copy — and it is the only one that does not fight the caret.
Re-rendering from React state on every keystroke would put the cursor back at
the start of the paragraph on every character typed.

`EditorHost` is a third `DocumentHost` alongside `BrowserHost` and `WordHost`.
Everything above that seam is unchanged: `useReCite` still calls
`read`/`apply`/`reveal` and still does not know which surface it has.

## Jumping to a citation

The citation in a finding **is** the control: click it and the document scrolls
to that citation, selects it, and lights it up for a moment. There is no
separate _Show_ button, because a finding is a claim about a specific run of
characters and the natural way to ask "where is that?" is to press the thing
itself. It is a real `<button>`, so it is reachable by keyboard and announced
as an action.

Three details are worth their code:

- **The frame scrolls, not the window.** `scrollIntoView` on an ancestor of the
  range would move the whole page — jarring, and it takes the panel the click
  came from off screen. The editor scrolls its own overflow container by the
  difference between the citation's rectangle and the frame's.
- **A moment of colour.** Scrolling a citation into view is not enough on a
  page of prose; the eye still has to find it. A separate highlight layer,
  outside the ones a check paints, is set on the jump and cleared on a timer —
  it fades rather than staying, because a permanent mark on the last thing you
  clicked is noise by the third click.
- **A miss is reported.** Offsets come from the last check and the document can
  move underneath them. `reveal` returns whether it landed, and the status line
  says so when it did not. A click that silently does nothing reads as a broken
  button.

The plain text box gets the same behaviour by a different route. `setSelectionRange`
selects but does not scroll, so `apps/web/src/textarea.ts` measures where the
offset sits — a hidden mirror with the same font, width and wrapping rules,
filled with the text up to that point — and scrolls there. Wrapping is
accounted for because the mirror wraps the same way, which is exactly what an
estimate from line counts gets wrong.

Clicking a note in the margin goes the other way, to the citation it is about.

Both surfaces focus with `preventScroll`. Focusing an element scrolls the
window to it by default, which would undo the frame scroll and take the panel
the click came from off screen.

The jump lands on the span the _rule_ is about, which is not always the whole
citation: `CT005` complains about a redundant `(U.S.` and selects exactly that.
Landing on the offending characters is the point — it is the difference between
"this citation has a problem" and "this is the problem".

## Comments in the margin

When CourtListener has supplied the passage a pin cite points at — see
[courtlistener.md](courtlistener.md) — each quotation appears in the right-hand
margin, anchored to the citation and pushed down far enough not to sit on the
one before it. Clicking a citation brings its note forward.

A pin cite that could not be quoted is shown too, with the reason, rather than
hidden. A reader who saw only the quoted ones would believe every page had been
checked.

Those same notes are written into a saved `.docx` or `.odt` as real comments.
The margin is a preview of the file, not a separate feature.

## What is tested where

The split is deliberate, and follows the rule the rest of this repository uses:
test a module where a module can answer, and use a real browser for the claims
only a real browser can settle.

| Where                            | What                                                     |
| -------------------------------- | -------------------------------------------------------- |
| `apps/web/test/document.test.ts` | the model: offsets, slicing, marks, applying corrections |
| `apps/web/test/export.test.ts`   | the marks surviving a round trip through each writer     |
| `apps/web/test/comments.test.ts` | comment markers landing on the right runs                |
| `tools/test/browser.test.ts`     | the editor itself, in Chromium                           |

Reading a `contenteditable` is precisely the sort of thing a fake DOM would
agree with and a real one would not, which is why no DOM shim was added for it.

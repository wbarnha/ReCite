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

## How big the page is

A page is only a page if you can read a line of it. The first version of this
editor could not be, on the machines most of its users have: on a 1920×1080
screen the line of prose was **164 pixels wide — about 25 characters**, and an
11,000-pixel document was shown through a 510-pixel window. The same document
on a phone got a wider line, which is the tell that nothing was responding to
the screen at all.

Four things were adding up, and each is worth stating because each is a
different mistake.

| What                                    | Why it was wrong                                                                                                                |
| --------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------- |
| `.app` capped at 1100px                 | a 2560px display used 43% of itself                                                                                             |
| `.columns` split exactly in half        | one half is a page of prose, the other a list of short findings — they do not want the same width                               |
| a 15rem comment margin, always          | it is **empty** until CourtListener has been asked for pincites, and it was taking 43% of the document's column to hold nothing |
| `.editor-frame` capped at a fixed 34rem | a third of a desktop screen, whatever the screen                                                                                |

The fix is four answers, and one of them matters more than the others.

**The margin's width is a question about the column, not the window.** Whether
the quotations fit beside the page depends on how wide the editor's own column
is — and once the findings sit in a column of their own, that is not the width
of the window. Keying it to the window produced a genuine cliff: at 960px the
media query stacked the margin under the page and the line was 334px; **one
pixel wider it un-stacked, took 15rem back out of a 452px column, and the line
collapsed to 94px.** A `@container` query on `.editor` asks the only element
that knows. Container queries are not a risk here — they shipped a full six
Chrome versions before `color-mix()`, which this stylesheet already uses.

The other three: the shell widens to 88rem, the findings column is capped at
24rem so what is left over goes to the document, the frame's height comes from
the screen (`clamp(34rem, 100vh - 24rem, 56rem)` — floored at what it always
was, so a short laptop is no worse off), and an empty margin takes no room at
all.

Two properties fall out of that, and both are load-bearing:

- **The line is the same width at every size.** 74 characters from 768px to
  2560px, degrading smoothly to 43 on a phone, because the page is capped at a
  measure rather than being a fraction of whatever room there is.
- **Pulling pincites does not reflow the prose.** The page stops growing before
  the frame does, so the margin appears beside a page that does not move —
  which matters because the notes are positioned from offsets measured against
  the layout as it was.

Two smaller things were fixed on the way. In the stacked layout `.page` had
nothing telling it to fill the frame, and `align-items: flex-start` is the
horizontal axis once a flex row becomes a column — so a document of short
paragraphs shrink-wrapped to **83px of text inside an 863px frame**. And the
browser test that bolds a word passed only _because_ the editor was too narrow:
it double-clicks a paragraph, Playwright aims at the middle of the box, and on
a page wide enough to hold the sentence in one line the middle falls past the
end of it and selects nothing. It now aims at a word.

`tools/test/browser.test.ts` measures the line in characters, at nine widths
including both sides of the old 961px cliff, so none of this can quietly come
back.

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

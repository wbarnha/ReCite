/**
 * Scrolling a textarea to a character offset.
 *
 * `setSelectionRange` selects a span; it does not reliably bring it into view.
 * On a document of any length that means clicking a finding highlights a
 * citation somewhere below the fold and appears to do nothing at all — which
 * is worse than not offering the jump, because the user concludes the tool is
 * broken rather than that they need to scroll.
 *
 * There is no API for "where is character 4,812 on screen". The measurement
 * below is the long-standing way round that: build a hidden element with the
 * same font, width and wrapping rules, fill it with the text up to the offset,
 * and read how tall it came out. Wrapping is accounted for because the mirror
 * wraps the same way, which is the part an estimate from line counts gets
 * wrong — and a jump that lands a few lines off is not much better than no
 * jump at all.
 */

/**
 * Properties that change where a character lands.
 *
 * Copied rather than assumed, because the app's own stylesheet is not the only
 * thing that sets them: a user stylesheet, a browser zoom or a font fallback
 * all move the text, and a mirror that disagreed with the textarea would scroll
 * confidently to the wrong place.
 */
const MIRRORED = [
  "boxSizing",
  "width",
  "paddingTop",
  "paddingRight",
  "paddingBottom",
  "paddingLeft",
  "borderTopWidth",
  "borderRightWidth",
  "borderBottomWidth",
  "borderLeftWidth",
  "fontStyle",
  "fontVariant",
  "fontWeight",
  "fontStretch",
  "fontSize",
  "fontFamily",
  "lineHeight",
  "letterSpacing",
  "wordSpacing",
  "textTransform",
  "textIndent",
  "tabSize",
  "whiteSpace",
  "overflowWrap",
  "wordBreak",
] as const;

/** How far down the content an offset sits, in pixels. */
export function offsetTop(node: HTMLTextAreaElement, offset: number): number {
  const doc = node.ownerDocument;
  const mirror = doc.createElement("div");
  const computed = doc.defaultView?.getComputedStyle(node);

  if (computed) {
    for (const property of MIRRORED) {
      mirror.style.setProperty(
        property.replace(/[A-Z]/g, (upper) => `-${upper.toLowerCase()}`),
        computed.getPropertyValue(
          property.replace(/[A-Z]/g, (upper) => `-${upper.toLowerCase()}`),
        ),
      );
    }
  }
  // Off-screen rather than `display: none`, which has no layout to measure.
  mirror.style.position = "absolute";
  mirror.style.top = "0";
  mirror.style.left = "-9999px";
  mirror.style.visibility = "hidden";
  mirror.style.height = "auto";
  mirror.style.overflow = "hidden";

  mirror.textContent = node.value.slice(0, offset);

  // A marker with real content: an empty span has no position of its own, and
  // a zero-width space would not extend an empty last line to a full one.
  const marker = doc.createElement("span");
  marker.textContent = node.value.slice(offset, offset + 1) || ".";
  mirror.appendChild(marker);

  node.parentElement?.appendChild(mirror);
  const top = marker.offsetTop;
  mirror.remove();

  return top;
}

/** The height of one line, for centring. */
export function lineHeight(node: HTMLTextAreaElement): number {
  const computed = node.ownerDocument.defaultView?.getComputedStyle(node);
  const declared = Number.parseFloat(computed?.lineHeight ?? "");
  if (Number.isFinite(declared)) return declared;

  // `normal`, which resolves per font. The 1.2 is the usual ratio and is only
  // used to centre, so being a pixel or two out is invisible.
  const size = Number.parseFloat(computed?.fontSize ?? "16");
  return (Number.isFinite(size) ? size : 16) * 1.2;
}

/**
 * Select `[start, end)` and bring it into view, roughly centred.
 *
 * Centred rather than scrolled to the top edge: a citation pinned to the first
 * visible line has no context above it, and the sentence a citation sits in is
 * usually the reason someone is looking.
 */
export function revealInTextarea(
  node: HTMLTextAreaElement,
  start: number,
  end: number,
): void {
  // `preventScroll`, so focusing does not move the window as well: the panel
  // the click came from has to stay where it was.
  node.focus({ preventScroll: true });
  node.setSelectionRange(start, end);

  const line = lineHeight(node);
  const wanted = offsetTop(node, start) - node.clientHeight / 2 + line / 2;
  const furthest = Math.max(0, node.scrollHeight - node.clientHeight);
  node.scrollTop = Math.max(0, Math.min(wanted, furthest));
}

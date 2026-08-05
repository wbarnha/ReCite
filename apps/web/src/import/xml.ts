/**
 * A tag scanner, for pulling readable text out of an XML document.
 *
 * Not a parser: it does not build a tree, validate, or resolve namespaces. It
 * walks the document emitting tags and text, which is all that extracting
 * prose from `word/document.xml` or `content.xml` requires.
 *
 * Written rather than using `DOMParser` for two reasons. It runs in a test
 * under Node without a DOM implementation, so the format handling is testable
 * without a browser; and extracting text by regular expression — the usual
 * shortcut — breaks on the first attribute value containing a `>`, which
 * office formats produce routinely.
 */

export interface Tag {
  readonly kind: "open" | "close" | "self-closing";
  /** Local name, namespace prefix stripped: `w:t` becomes `t`. */
  readonly name: string;
  /** Name including any prefix, for callers that need to disambiguate. */
  readonly qualifiedName: string;
}

export interface TextNode {
  readonly kind: "text";
  readonly text: string;
}

export type Node = Tag | TextNode;

const ENTITIES: Record<string, string> = {
  amp: "&",
  lt: "<",
  gt: ">",
  quot: '"',
  apos: "'",
  nbsp: " ",
};

/** Resolve the five XML entities plus numeric character references. */
export function decodeEntities(value: string): string {
  if (!value.includes("&")) return value;

  return value.replace(/&(#x?[0-9a-fA-F]+|[a-zA-Z]+);/g, (whole, body: string) => {
    if (body.startsWith("#x") || body.startsWith("#X")) {
      const code = Number.parseInt(body.slice(2), 16);
      return Number.isFinite(code) ? String.fromCodePoint(code) : whole;
    }
    if (body.startsWith("#")) {
      const code = Number.parseInt(body.slice(1), 10);
      return Number.isFinite(code) ? String.fromCodePoint(code) : whole;
    }
    return ENTITIES[body.toLowerCase()] ?? whole;
  });
}

/**
 * Walk the document, yielding tags and text in order.
 *
 * Comments, processing instructions and DOCTYPE declarations are skipped;
 * CDATA sections are emitted as text.
 */
export function* scan(xml: string): Generator<Node> {
  let index = 0;

  while (index < xml.length) {
    const next = xml.indexOf("<", index);

    if (next === -1) {
      const text = xml.slice(index);
      if (text) yield { kind: "text", text: decodeEntities(text) };
      return;
    }

    if (next > index) {
      yield { kind: "text", text: decodeEntities(xml.slice(index, next)) };
    }

    // `<![CDATA[ ... ]]>` — content is literal, entities are not resolved.
    if (xml.startsWith("<![CDATA[", next)) {
      const end = xml.indexOf("]]>", next);
      const stop = end === -1 ? xml.length : end;
      yield { kind: "text", text: xml.slice(next + 9, stop) };
      index = end === -1 ? xml.length : end + 3;
      continue;
    }

    if (xml.startsWith("<!--", next)) {
      const end = xml.indexOf("-->", next);
      index = end === -1 ? xml.length : end + 3;
      continue;
    }

    if (xml.startsWith("<?", next) || xml.startsWith("<!", next)) {
      const end = xml.indexOf(">", next);
      index = end === -1 ? xml.length : end + 1;
      continue;
    }

    const end = findTagEnd(xml, next);
    if (end === -1) {
      // An unterminated `<` at the very end: treat it as text rather than
      // losing the tail of the document.
      yield { kind: "text", text: decodeEntities(xml.slice(next)) };
      return;
    }

    const raw = xml.slice(next + 1, end);
    index = end + 1;

    const closing = raw.startsWith("/");
    const selfClosing = raw.endsWith("/");
    const body = raw.slice(closing ? 1 : 0, selfClosing ? -1 : undefined).trim();
    if (!body) continue;

    const qualifiedName = /^[^\s/>]+/.exec(body)?.[0] ?? "";
    if (!qualifiedName) continue;

    yield {
      kind: closing ? "close" : selfClosing ? "self-closing" : "open",
      name: qualifiedName.includes(":")
        ? qualifiedName.slice(qualifiedName.indexOf(":") + 1)
        : qualifiedName,
      qualifiedName,
    };
  }
}

/**
 * The `>` that closes a tag, skipping any inside quoted attribute values.
 *
 * This is the whole reason for not doing this with a regular expression:
 * `<w:t xml:space="preserve" foo="a>b">` is legal and a naive scan stops in
 * the middle of it.
 */
function findTagEnd(xml: string, start: number): number {
  let quote: string | undefined;

  for (let i = start + 1; i < xml.length; i++) {
    const ch = xml[i];
    if (quote) {
      if (ch === quote) quote = undefined;
      continue;
    }
    if (ch === '"' || ch === "'") {
      quote = ch;
      continue;
    }
    if (ch === ">") return i;
  }
  return -1;
}

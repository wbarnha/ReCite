"""Turning a document into :class:`ParsedCitation` objects via eyecite.

Two things matter here and nothing else does.

**Offsets stay true.** eyecite ships ``clean_text`` helpers that strip HTML and
squeeze whitespace, which improves recall but shifts every character position.
Because ReCite's whole job is to hand back an edited version of the caller's
document, cleaning is off by default: spans reported here index the exact
string passed in. Callers that want cleaning should clean first and treat the
cleaned string as the document.

**Short forms are tied to their antecedents.** ``Id. at 5`` is only checkable
if you know which case it follows, so extraction runs eyecite's resolver and
records the grouping on each citation as ``resource_key``.

.. note:: **Working around an eyecite ``full_span`` regression.**

   In eyecite 2.7.x a citation's ``full_span`` can begin *inside the previous
   citation*, so the second cite in ``A, 1 U.S. 1 (1801). B, 2 U.S. 2 (1802)``
   spans from ``1 U.S. 1`` onward and reports 1801 as its year. Since a wrong
   year silently poisons every date rule, this module does not trust
   ``metadata.year``: it reads the year out of the citation's own trailing
   parenthetical — the text between ``span.end`` and ``full_span.end``, which
   is unaffected — and clamps ``full_span.start`` so it can never precede the
   previous citation. eyecite's value is used only when there is no
   parenthetical to read.
"""

from __future__ import annotations

import re
from collections.abc import Iterable, Sequence
from dataclasses import dataclass, field
from typing import Any

from eyecite import clean_text, get_citations, resolve_citations

from .models import ParsedCitation, Span

__all__ = ["Extraction", "extract"]

# The court/year parenthetical that trails a full citation, e.g. "(9th Cir. 1997)".
_PARENTHETICAL = re.compile(r"\(([^()]*)\)")
_YEAR = re.compile(r"\b(1[5-9]\d{2}|2\d{3})\b")


@dataclass
class Extraction:
    """Everything ReCite knows about the citations in one document."""

    text: str
    citations: list[ParsedCitation] = field(default_factory=list)
    resources: dict[str, list[int]] = field(default_factory=dict)
    """``resource_key -> citation indexes``, in document order."""

    @property
    def full_citations(self) -> list[ParsedCitation]:
        return [c for c in self.citations if c.is_full]

    @property
    def unresolved(self) -> list[ParsedCitation]:
        """Short forms eyecite could not attach to any earlier full citation."""
        return [c for c in self.citations if c.is_short_form and c.resource_key is None]

    def by_index(self, index: int) -> ParsedCitation:
        return self.citations[index]

    def antecedent_of(self, citation: ParsedCitation) -> ParsedCitation | None:
        """The full citation a short form refers to, if it has one."""
        if citation.resource_key is None:
            return None
        for index in self.resources.get(citation.resource_key, []):
            candidate = self.citations[index]
            if candidate.is_full:
                return candidate
        return None


def extract(
    text: str,
    *,
    clean: Sequence[str] = (),
    remove_ambiguous: bool = False,
) -> Extraction:
    """Find every citation in ``text``.

    Args:
        text: The document. Spans in the result index into this exact string.
        clean: Optional ``eyecite.clean`` step names (``"html"``,
            ``"inline_whitespace"``, ``"all_whitespace"``, ``"underscores"``,
            ``"xml"``). Supplying any of these rewrites the text, so
            :attr:`Extraction.text` — not the argument — becomes the document
            the spans belong to.
        remove_ambiguous: Drop citations whose reporter could belong to several
            series. Off by default: ReCite would rather flag the ambiguity than
            hide the citation.
    """
    if clean:
        text = clean_text(text, list(clean))

    # eyecite raises when handed a blank document, and an empty file is a
    # perfectly ordinary thing to point a linter at.
    if not text.strip():
        return Extraction(text=text)

    raw_citations = get_citations(text, remove_ambiguous=remove_ambiguous)
    resource_keys = _resolve(raw_citations)

    citations: list[ParsedCitation] = []
    resources: dict[str, list[int]] = {}

    boundary = 0
    for index, raw in enumerate(raw_citations):
        parsed = _to_parsed(index, raw, text, resource_keys.get(id(raw)), boundary)
        citations.append(parsed)
        boundary = parsed.full_span.end
        if parsed.resource_key is not None:
            resources.setdefault(parsed.resource_key, []).append(index)

    return Extraction(text=text, citations=citations, resources=resources)


def _resolve(raw_citations: Iterable[Any]) -> dict[int, str]:
    """Map ``id(citation) -> resource key`` using eyecite's resolver.

    Keyed by object identity rather than value because a brief may cite the
    same case twice and those two objects must stay distinguishable.
    """
    try:
        resolved = resolve_citations(list(raw_citations))
    except Exception:  # pragma: no cover - resolver is best-effort by design
        return {}

    keys: dict[int, str] = {}
    for resource, members in resolved.items():
        key = _resource_key(resource)
        for member in members:
            keys[id(member)] = key
    return keys


def _resource_key(resource: Any) -> str:
    """A stable, human-legible name for a group of citations to one case."""
    citation = getattr(resource, "citation", None)
    if citation is not None:
        try:
            return str(citation.corrected_citation())
        except Exception:  # pragma: no cover - defensive
            pass
    return str(resource)


def _to_parsed(
    index: int,
    raw: Any,
    text: str,
    resource_key: str | None,
    boundary: int,
) -> ParsedCitation:
    metadata = getattr(raw, "metadata", None)
    groups = getattr(raw, "groups", None) or {}

    span = Span(*raw.span())
    full_span = _clamp_full_span(text, span, Span(*raw.full_span()), boundary)
    court_text, court_text_span = _court_text(text, span, full_span)

    return ParsedCitation(
        index=index,
        kind=type(raw).__name__,
        text=raw.matched_text(),
        span=span,
        full_span=full_span,
        corrected=_corrected(raw),
        volume=groups.get("volume"),
        reporter=groups.get("reporter"),
        reporter_canonical=_canonical_reporter(raw),
        reporter_is_scotus=_is_scotus_reporter(raw),
        reporter_ambiguous=len(getattr(raw, "all_editions", ()) or ()) > 1,
        page=groups.get("page"),
        year=_year(text, span, full_span, raw, metadata),
        court_id=_meta(metadata, "court"),
        court_text=court_text,
        court_text_span=court_text_span,
        plaintiff=_meta(metadata, "plaintiff"),
        defendant=_meta(metadata, "defendant"),
        pin_cite=_meta(metadata, "pin_cite"),
        parenthetical=_meta(metadata, "parenthetical"),
        antecedent_guess=_meta(metadata, "antecedent_guess"),
        resource_key=resource_key,
        raw=raw,
    )


def _meta(metadata: Any, name: str) -> str | None:
    value = getattr(metadata, name, None)
    return str(value) if value else None


def _corrected(raw: Any) -> str:
    try:
        return str(raw.corrected_citation())
    except Exception:  # pragma: no cover - defensive
        return str(raw.matched_text())


def _canonical_reporter(raw: Any) -> str | None:
    """The canonical edition name eyecite matched, e.g. ``"F. 3d" -> "F.3d"``."""
    edition = getattr(raw, "edition_guess", None)
    name = getattr(edition, "short_name", None)
    return str(name) if name else None


def _is_scotus_reporter(raw: Any) -> bool:
    """Whether the reporter only ever publishes the Supreme Court.

    Read off eyecite's own ``Reporter.is_scotus`` flag rather than re-derived
    here, so ReCite and eyecite can never disagree about it.
    """
    edition = getattr(raw, "edition_guess", None)
    reporter = getattr(edition, "reporter", None)
    return bool(getattr(reporter, "is_scotus", False))


def _clamp_full_span(text: str, span: Span, full_span: Span, boundary: int) -> Span:
    """Stop a citation's full span from reaching back into the previous one.

    See the module docstring: eyecite 2.7.x can start ``full_span`` before the
    preceding citation ends. ``boundary`` is the previous citation's (already
    clamped) end; the start is pushed past it and then past any leftover
    sentence punctuation so the span begins at the case name.
    """
    start = max(full_span.start, boundary)
    start = min(start, span.start)
    while start < span.start and text[start] in ".,;: \t\n":
        start += 1
    return Span(start, full_span.end)


def _year(
    text: str, span: Span, full_span: Span, raw: Any, metadata: Any
) -> int | None:
    """The year of decision, read from the citation's own parenthetical.

    Preferred over ``metadata.year`` because the latter is derived from
    ``full_span``, which eyecite 2.7.x can misplace. The tail — everything
    between the citation and the end of its parenthetical — always belongs to
    this citation, so a year found there is unambiguous.
    """
    match = _YEAR.search(text[span.end : full_span.end])
    if match is not None:
        return int(match.group(1))

    year = getattr(raw, "year", None)
    if isinstance(year, int):
        return year

    reported = _meta(metadata, "year")
    if reported and reported.isdigit():
        return int(reported)
    return None


def _court_text(
    text: str, span: Span, full_span: Span
) -> tuple[str | None, Span | None]:
    """The court abbreviation as the author actually typed it, and where it sits.

    eyecite hands back a resolved ``courts-db`` id, which is what we want for
    checking, but to *rewrite* the parenthetical we need the original
    characters and their offsets. Returns ``(None, None)`` for a bare year
    parenthetical like ``(1973)``, which has no court to correct.

    Note this is only a *candidate*: ``(en banc)`` also parses as court text.
    Callers are expected to discard anything ``courts-db`` cannot resolve.
    """
    tail = text[span.end : full_span.end]
    match = _PARENTHETICAL.search(tail)
    if match is None:
        return (None, None)

    body = match.group(1)
    body_start = span.end + match.start(1)

    year_match = _YEAR.search(body)
    candidate = body[: year_match.start()] if year_match else body

    stripped = candidate.strip(" ,;")
    if not stripped:
        return (None, None)

    offset = body_start + candidate.index(stripped)
    return (stripped, Span(offset, offset + len(stripped)))

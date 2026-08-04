"""Rules about how citations hang together in a document (the ``ST`` family)."""

from __future__ import annotations

import re
from collections.abc import Iterable

from recite.core import Diagnostic, ParsedCitation, Severity

from .base import Rule, RuleContext

__all__ = ["PinCiteOutOfRange", "UnresolvedShortForm"]

_LEADING_NUMBER = re.compile(r"\d+")

_SHORT_FORM_LABELS = {
    "IdCitation": "An `Id.` citation",
    "SupraCitation": "A `supra` citation",
    "ShortCaseCitation": "A short-form citation",
    "ReferenceCitation": "A short-name reference",
}


class UnresolvedShortForm(Rule):
    """``Id. at 45`` with no full citation before it to attach to.

    Short forms are the easiest thing to break while editing: move a paragraph
    and the ``Id.`` that opened it now points at the wrong case, or at nothing.
    eyecite's resolver already does the hard part; this rule reports the cases
    where it came up empty.
    """

    id = "ST001"
    name = "unresolved-short-form"
    summary = "Short-form citation has no antecedent full citation."
    severity = Severity.ERROR

    def check(self, ctx: RuleContext) -> Iterable[Diagnostic]:
        for citation in ctx.extraction.unresolved:
            label = _SHORT_FORM_LABELS.get(citation.kind, "A short-form citation")
            hint = (
                f" It seems to refer to {citation.antecedent_guess!r}, which is "
                f"not cited in full anywhere earlier."
                if citation.antecedent_guess
                else " Cite the case in full the first time it appears."
            )
            yield self.diagnostic(
                citation,
                f"{label} ({citation.text!r}) does not follow any full citation.{hint}",
                kind=citation.kind,
                antecedent_guess=citation.antecedent_guess,
            )


class PinCiteOutOfRange(Rule):
    """A pin cite that precedes the page the opinion starts on.

    ``410 U.S. 113, 99`` cannot be right: page 99 comes before the case does.
    Only the lower bound is checkable offline — we cannot know where an opinion
    ends without looking it up — but transposed digits usually trip this.
    """

    id = "ST002"
    name = "pin-cite-out-of-range"
    summary = "Pin cite points at a page before the opinion begins."
    severity = Severity.WARNING

    def check(self, ctx: RuleContext) -> Iterable[Diagnostic]:
        for citation in ctx.citations:
            pin = _first_number(citation.pin_cite)
            if pin is None:
                continue

            first_page = self._first_page(ctx, citation)
            if first_page is None or pin >= first_page:
                continue

            yield self.diagnostic(
                citation,
                f"Pin cite {pin} is before page {first_page}, where the "
                f"opinion starts.",
                pin_cite=pin,
                first_page=first_page,
            )

    def _first_page(self, ctx: RuleContext, citation: ParsedCitation) -> int | None:
        """Where the opinion starts, following short forms back to their source."""
        if citation.is_full:
            return _first_number(citation.page)

        # For `347 U.S. at 495` the parsed "page" is the pin cite itself, so
        # the real first page has to come from the full citation it resolves to.
        antecedent = ctx.extraction.antecedent_of(citation)
        return _first_number(antecedent.page) if antecedent else None


def _first_number(value: str | None) -> int | None:
    """First integer in a pin cite, tolerating ``"at 555"`` and ``"555-57"``."""
    if not value:
        return None
    match = _LEADING_NUMBER.search(value)
    return int(match.group()) if match else None

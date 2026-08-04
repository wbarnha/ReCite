"""Rules about the reporter abbreviation itself (the ``RP`` family)."""

from __future__ import annotations

import re
from collections.abc import Iterable

from recite.core import (
    Correction,
    Diagnostic,
    FixSafety,
    Severity,
    Span,
    canonical_editions_for_variation,
    differs_only_cosmetically,
    edition_info,
    editions_covering_year,
    is_variation,
    suggest_editions,
)

from .base import Rule, RuleContext

__all__ = ["AmbiguousReporter", "ReporterFormat", "UnrecognizedReporter"]


class ReporterFormat(Rule):
    """``123 F. 3d 456`` -> ``123 F.3d 456``; ``12 Fed. Rep. 34`` -> ``12 F. 34``."""

    id = "RP001"
    name = "reporter-format"
    summary = "Reporter abbreviation is misspaced or uses a non-standard variant."
    severity = Severity.INFO

    def check(self, ctx: RuleContext) -> Iterable[Diagnostic]:
        for citation in ctx.citations:
            if not citation.reporter or citation.text == citation.corrected:
                continue

            # A different abbreviation for the same reporter ("Fed. Rep." for
            # "F.") is a substantive style error; "U. S." for "U.S." is just
            # stray whitespace and should not shout at the reader.
            cosmetic = differs_only_cosmetically(
                citation.reporter, citation.reporter_canonical or citation.reporter
            )
            severity = Severity.INFO if cosmetic else Severity.WARNING
            reason = (
                "spacing and punctuation do not match the standard form"
                if cosmetic
                else f"{citation.reporter!r} is a non-standard abbreviation"
            )

            yield self.diagnostic(
                citation,
                f"{citation.text!r} should be written {citation.corrected!r} "
                f"— {reason}.",
                severity=severity,
                # eyecite's own canonicalisation: the authority is unchanged,
                # only how it is spelled, so this is always safe to apply.
                replacement=citation.corrected,
                safety=FixSafety.SAFE,
                fix_description=f"Normalise to {citation.corrected!r}",
                reporter=citation.reporter,
                canonical=citation.reporter_canonical,
                cosmetic=cosmetic,
                known_variation=is_variation(citation.reporter),
            )


class AmbiguousReporter(Rule):
    """An abbreviation several reporter series share, e.g. bare ``"S."``."""

    id = "RP002"
    name = "ambiguous-reporter"
    summary = "Reporter abbreviation matches more than one reporter series."
    severity = Severity.WARNING

    def check(self, ctx: RuleContext) -> Iterable[Diagnostic]:
        for citation in ctx.citations:
            if not citation.reporter_ambiguous or not citation.reporter:
                continue

            # The year usually settles it: only one of the candidate series was
            # being published when the case came down.
            resolved: str | None = None
            if citation.year and citation.reporter_canonical:
                covering = editions_covering_year(
                    citation.reporter_canonical, citation.year
                )
                if len(covering) == 1:
                    resolved = covering[0].name

            message = (
                f"{citation.reporter!r} is ambiguous — it matches several "
                f"reporter series."
            )
            if resolved and resolved != citation.reporter:
                yield self.diagnostic(
                    citation,
                    f"{message} Given the {citation.year} date it is most "
                    f"likely {resolved!r}.",
                    replacement=citation.corrected.replace(
                        citation.reporter, resolved, 1
                    ),
                    safety=FixSafety.UNSAFE,
                    fix_description=f"Disambiguate to {resolved!r}",
                    reporter=citation.reporter,
                    resolved=resolved,
                )
            else:
                hint = (
                    "Spell the reporter series out."
                    if citation.year
                    else "Add the year of decision, or spell the series out."
                )
                yield self.diagnostic(
                    citation,
                    f"{message} {hint}",
                    reporter=citation.reporter,
                )


# A volume/reporter/page shape that eyecite did *not* claim. The reporter token
# must contain a period, which is what separates a genuine abbreviation from
# prose like "5 percent 20".
_CITATION_SHAPE = re.compile(
    r"\b(?P<volume>\d{1,4})\s+"
    r"(?P<reporter>[A-Z][A-Za-z.'’\- ]{0,24}?\.(?:\s?\d(?:d|th|rd|st))?)\s+"
    r"(?P<page>\d{1,5})\b"
)


class UnrecognizedReporter(Rule):
    """Citation-shaped text whose reporter is in no reporter database.

    eyecite reports nothing at all for ``100 Xzy. 200``, so without this rule a
    mistyped reporter is invisible: the citation simply vanishes from the
    report rather than being flagged. The regex is deliberately narrow and a
    finding is only raised when ``reporters-db`` offers a close match, which
    keeps ordinary numbers in prose from being mistaken for citations.
    """

    id = "RP003"
    name = "unrecognized-reporter"
    summary = "Text looks like a citation but names no known reporter."
    severity = Severity.ERROR

    #: Minimum similarity to a real abbreviation before we say anything.
    cutoff = 0.8

    def check(self, ctx: RuleContext) -> Iterable[Diagnostic]:
        covered = [c.span for c in ctx.citations]

        for match in _CITATION_SHAPE.finditer(ctx.text):
            span = Span(*match.span())
            if any(span.overlaps(other) for other in covered):
                continue

            token = match.group("reporter").strip()

            # Skip anything reporters-db recognises, canonical or variant.
            # A real reporter that eyecite did not claim usually means the
            # citation was wrapped across lines by a PDF extractor — annoying,
            # but emphatically not an unknown reporter, and saying so would be
            # both wrong and the most common message users saw.
            if edition_info(token) is not None or canonical_editions_for_variation(
                token
            ):
                continue

            suggestions = suggest_editions(token, limit=3, cutoff=self.cutoff)
            if not suggestions:
                continue

            best = suggestions[0]
            alternatives = (
                f" (or {', '.join(repr(s) for s in suggestions[1:])})"
                if len(suggestions) > 1
                else ""
            )

            yield Diagnostic(
                rule_id=self.id,
                severity=self.severity,
                message=(
                    f"{token!r} is not a known reporter. "
                    f"Did you mean {best!r}{alternatives}?"
                ),
                span=span,
                citation_text=match.group(0),
                # Rewrite only the reporter token, leaving volume and page be.
                correction=Correction(
                    span=Span(*match.span("reporter")),
                    replacement=best,
                    safety=FixSafety.UNSAFE,
                    description=f"Replace {token!r} with {best!r}",
                ),
                context={"token": token, "suggestions": suggestions},
            )

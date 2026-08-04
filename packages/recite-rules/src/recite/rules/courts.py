"""Rules about the court parenthetical (the ``CT`` family)."""

from __future__ import annotations

from collections.abc import Iterable

from recite.core import (
    Diagnostic,
    FixSafety,
    Severity,
    court_citation_string,
    court_info,
    resolve_court,
)

from .base import Rule, RuleContext

__all__ = ["CourtAbbreviation", "CourtDidNotExist", "ReporterCourtMismatch"]

#: A U.S. cite implies the Supreme Court, so the Bluebook omits the court
#: entirely. Rewriting the parenthetical to courts-db's "SCOTUS" would be
#: wrong, so the abbreviation rule leaves these alone.
_SKIP_ABBREVIATION = {"scotus"}


def _mentions_bankruptcy(written: str) -> bool:
    return "bankr" in written.lower()


class CourtAbbreviation(Rule):
    """``(Ninth Circuit 1997)`` -> ``(9th Cir. 1997)``."""

    id = "CT001"
    name = "court-abbreviation"
    summary = "Court is named in a form other than its Bluebook abbreviation."
    severity = Severity.INFO

    def check(self, ctx: RuleContext) -> Iterable[Diagnostic]:
        for citation in ctx.citations:
            written = citation.court_text
            span = citation.court_text_span
            if not written or span is None:
                continue

            # Only act on text courts-db actually recognises. Parentheticals
            # like "(en banc)" or "(per curiam)" resolve to nothing and must
            # be left untouched.
            court_id = resolve_court(
                written,
                citation.year,
                # Without this, "S.D. New York" resolves to the *bankruptcy*
                # court for that district and we would happily rewrite a
                # district cite into a bankruptcy one.
                bankruptcy=_mentions_bankruptcy(written),
            )
            if court_id is None or court_id in _SKIP_ABBREVIATION:
                continue

            canonical = court_citation_string(court_id)
            if not canonical or canonical == written:
                continue

            yield self.diagnostic(
                citation,
                f"Court is written {written!r}; the standard abbreviation is "
                f"{canonical!r}.",
                span=span,
                replacement=canonical,
                fix_span=span,
                safety=FixSafety.UNSAFE,
                fix_description=f"Abbreviate court as {canonical!r}",
                court_id=court_id,
                written=written,
            )


class ReporterCourtMismatch(Rule):
    """``200 U.S. 1 (9th Cir. 1906)`` — the U.S. Reports only carry SCOTUS.

    A reporter that publishes exactly one court contradicts any other court in
    the parenthetical, which usually means two citations were spliced together.
    """

    id = "CT002"
    name = "reporter-court-mismatch"
    summary = "Court in the parenthetical cannot appear in that reporter."
    severity = Severity.ERROR

    def check(self, ctx: RuleContext) -> Iterable[Diagnostic]:
        for citation in ctx.citations:
            if not citation.reporter_is_scotus:
                continue
            if citation.court_id is None or citation.court_id == "scotus":
                continue

            court = court_info(citation.court_id)
            court_name = court.name if court else citation.court_id

            yield self.diagnostic(
                citation,
                f"{citation.reporter_canonical or citation.reporter!r} only "
                f"reports the Supreme Court of the United States, but the "
                f"parenthetical names {court_name}.",
                reporter=citation.reporter_canonical,
                court_id=citation.court_id,
            )


class CourtDidNotExist(Rule):
    """A court cited for a year before it was created or after it was abolished."""

    id = "CT003"
    name = "court-did-not-exist"
    summary = "Court was not sitting in the year given."
    severity = Severity.WARNING

    def check(self, ctx: RuleContext) -> Iterable[Diagnostic]:
        for citation in ctx.citations:
            if citation.court_id is None or citation.year is None:
                continue

            court = court_info(citation.court_id)
            if court is None or court.start_year is None:
                continue  # unknown lifespan proves nothing
            if court.existed_in(citation.year):
                continue

            yield self.diagnostic(
                citation,
                f"{court.name} existed {court.lifespan_label()}, so it could "
                f"not have decided a case in {citation.year}.",
                court_id=court.id,
                year=citation.year,
                lifespan=court.lifespan_label(),
            )

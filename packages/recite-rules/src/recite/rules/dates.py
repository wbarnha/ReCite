"""Rules that check the year against reality (the ``DT`` family)."""

from __future__ import annotations

from collections.abc import Iterable

from recite.core import (
    Diagnostic,
    FixSafety,
    Severity,
    edition_info,
    editions_covering_year,
)

from .base import Rule, RuleContext

__all__ = ["ImplausibleYear", "YearOutsideEdition"]

#: Before this, nothing in the reporter databases exists; a year below it is a
#: typo rather than a very old case.
_EARLIEST_PLAUSIBLE_YEAR = 1600


class YearOutsideEdition(Rule):
    """``999 F.3d 1 (2d Cir. 1950)`` — F.3d did not exist until 1993.

    This is the single most useful offline check: it catches a fabricated or
    transposed citation without needing any network access, because a reporter
    series and a date are enough to prove the pairing impossible.
    """

    id = "DT001"
    name = "year-outside-edition"
    summary = "Decision year falls outside the years that reporter was published."
    severity = Severity.ERROR

    def check(self, ctx: RuleContext) -> Iterable[Diagnostic]:
        for citation in ctx.citations:
            reporter = citation.reporter_canonical
            if not reporter or citation.year is None:
                continue

            edition = edition_info(reporter)
            if edition is None or edition.covers(citation.year):
                continue

            # Often the author meant a neighbouring edition of the same series
            # — F.2d rather than F.3d — which we can name precisely.
            alternatives = editions_covering_year(reporter, citation.year)
            detail = (
                f"{reporter} was published {edition.coverage_label()}, "
                f"but this cites {citation.year}."
            )

            if len(alternatives) == 1:
                replacement = alternatives[0].name
                yield self.diagnostic(
                    citation,
                    f"{detail} A {citation.year} case in this series would be "
                    f"in {replacement!r}.",
                    replacement=citation.corrected.replace(reporter, replacement, 1),
                    safety=FixSafety.UNSAFE,
                    fix_description=f"Change reporter to {replacement!r}",
                    reporter=reporter,
                    year=citation.year,
                    suggestion=replacement,
                )
            else:
                yield self.diagnostic(
                    citation,
                    f"{detail} Check the volume, the reporter and the year.",
                    reporter=reporter,
                    year=citation.year,
                    coverage=edition.coverage_label(),
                )


class ImplausibleYear(Rule):
    """A year that cannot be right on its face — in the future, or medieval."""

    id = "DT002"
    name = "implausible-year"
    summary = "Decision year is in the future or impossibly early."
    severity = Severity.ERROR

    def check(self, ctx: RuleContext) -> Iterable[Diagnostic]:
        for citation in ctx.citations:
            if citation.year is None:
                continue

            if citation.year > ctx.current_year:
                yield self.diagnostic(
                    citation,
                    f"Cites a decision dated {citation.year}, which is in the "
                    f"future (this year is {ctx.current_year}).",
                    year=citation.year,
                )
            elif citation.year < _EARLIEST_PLAUSIBLE_YEAR:
                yield self.diagnostic(
                    citation,
                    f"Decision year {citation.year} predates any reporter in "
                    f"the database — likely a typo.",
                    severity=Severity.WARNING,
                    year=citation.year,
                )

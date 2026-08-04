"""Rules that need CourtListener (the ``VF`` family).

These are inert without verification results, which is what
:attr:`Rule.requires_verification` signals to the engine. Everything here
compares what the document claims against what the Free Law Project's database
actually holds, so this is the family that catches an invented citation whose
formatting happens to be impeccable.
"""

from __future__ import annotations

import re
from collections.abc import Iterable

from recite.core import Diagnostic, Severity, VerifiedCluster

from .base import Rule, RuleContext

__all__ = [
    "AmbiguousAuthority",
    "CaseNameMismatch",
    "UnknownAuthority",
    "YearMismatch",
]

_WORD = re.compile(r"[a-z0-9]+")

#: Words that carry no identifying weight when comparing two case names.
_NOISE = {
    "and",
    "co",
    "coop",
    "corp",
    "inc",
    "llc",
    "llp",
    "ltd",
    "of",
    "the",
    "v",
}


class UnknownAuthority(Rule):
    """The citation is well-formed but matches nothing in CourtListener."""

    id = "VF001"
    name = "unknown-authority"
    summary = "Citation is not in the CourtListener database."
    severity = Severity.ERROR
    requires_verification = True

    def check(self, ctx: RuleContext) -> Iterable[Diagnostic]:
        for citation in ctx.citations:
            result = ctx.verification_for(citation)
            if result is None or not result.not_found:
                continue

            yield self.diagnostic(
                citation,
                f"{citation.corrected!r} is a valid-looking citation, but no "
                f"such case is in CourtListener. Verify it exists.",
                status=result.status,
                error_message=result.error_message,
            )


class AmbiguousAuthority(Rule):
    """The citation matches several cases — usually a missing parallel cite."""

    id = "VF002"
    name = "ambiguous-authority"
    summary = "Citation matches more than one case in CourtListener."
    severity = Severity.WARNING
    requires_verification = True

    def check(self, ctx: RuleContext) -> Iterable[Diagnostic]:
        for citation in ctx.citations:
            result = ctx.verification_for(citation)
            if result is None or not result.ambiguous:
                continue

            names = [c.case_name for c in result.clusters if c.case_name]
            listed = "; ".join(names[:3]) or "several cases"
            more = f" (and {len(names) - 3} more)" if len(names) > 3 else ""

            yield self.diagnostic(
                citation,
                f"{citation.corrected!r} matches multiple cases: {listed}"
                f"{more}. Add a court or year to disambiguate.",
                status=result.status,
                candidates=names,
            )


class CaseNameMismatch(Rule):
    """The reporter cite is real, but it belongs to a different case.

    This is the check that catches a hallucinated citation: a plausible case
    name bolted onto a real volume and page. Comparison is by significant-word
    overlap rather than string equality, because ``Bell Atl. Corp. v. Twombly``
    and ``Bell Atlantic Corporation v. Twombly`` are the same case.
    """

    id = "VF003"
    name = "case-name-mismatch"
    summary = "Cited case name does not match the case at that citation."
    severity = Severity.ERROR
    requires_verification = True

    #: Below this share of shared significant words, call it a different case.
    threshold = 0.34

    def check(self, ctx: RuleContext) -> Iterable[Diagnostic]:
        for citation in ctx.citations:
            result = ctx.verification_for(citation)
            cited_name = citation.case_name
            if result is None or not result.matched or not cited_name:
                continue
            # Only a full citation states a case name to be wrong about.
            if not citation.is_full:
                continue

            cluster = result.clusters[0]
            if not cluster.case_name:
                continue
            if _similarity(cited_name, cluster.case_name) >= self.threshold:
                continue

            yield self.diagnostic(
                citation,
                f"{citation.corrected!r} is {cluster.case_name!r}, not {cited_name!r}.",
                cited_name=cited_name,
                actual_name=cluster.case_name,
                url=cluster.url,
            )


class YearMismatch(Rule):
    """The case exists, but was decided in a different year than cited.

    Deliberately reports without offering a fix. A year that disagrees with
    the database is usually a symptom — the wrong volume, or two cases
    conflated — and quietly rewriting the year would make the citation *look*
    verified while leaving the actual error in place.
    """

    id = "VF004"
    name = "year-mismatch"
    summary = "Decision year disagrees with CourtListener."
    severity = Severity.WARNING
    requires_verification = True

    def check(self, ctx: RuleContext) -> Iterable[Diagnostic]:
        for citation in ctx.citations:
            result = ctx.verification_for(citation)
            if result is None or not result.matched or citation.year is None:
                continue

            cluster: VerifiedCluster = result.clusters[0]
            actual = cluster.year
            if actual is None or actual == citation.year:
                continue

            yield self.diagnostic(
                citation,
                f"Cited as {citation.year}, but CourtListener dates "
                f"{cluster.case_name or citation.corrected} to {actual}.",
                cited_year=citation.year,
                actual_year=actual,
                url=cluster.url,
            )


def _significant_words(name: str) -> set[str]:
    return {w for w in _WORD.findall(name.lower()) if w not in _NOISE and len(w) > 1}


def _similarity(left: str, right: str) -> float:
    """Jaccard overlap of the significant words in two case names."""
    a, b = _significant_words(left), _significant_words(right)
    if not a or not b:
        return 1.0  # nothing to compare, so do not accuse
    return len(a & b) / len(a | b)

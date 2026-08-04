from __future__ import annotations

import pytest

from recite.core import CitationVerification, Diagnostic, VerifiedCluster, extract
from recite.rules import Rule, RuleContext, run_rules


@pytest.fixture
def check():
    """Run one rule (or all of them) over a string and return the diagnostics."""

    def _check(
        text: str,
        rule: Rule | None = None,
        *,
        verifications: dict[int, CitationVerification] | None = None,
        current_year: int = 2026,
    ) -> list[Diagnostic]:
        ctx = RuleContext(
            extraction=extract(text),
            verifications=verifications or {},
            current_year=current_year,
        )
        return run_rules(ctx, [rule] if rule is not None else None)

    return _check


@pytest.fixture
def verification():
    """Build a CitationVerification without spelling out every field."""

    def _verification(
        index: int = 0,
        status: int = 200,
        *,
        case_name: str | None = None,
        date_filed: str | None = None,
        cluster_count: int = 1,
    ) -> CitationVerification:
        clusters = tuple(
            VerifiedCluster(
                cluster_id=n,
                case_name=case_name if n == 0 else f"{case_name} ({n})",
                date_filed=date_filed,
                absolute_url=f"/opinion/{n}/",
            )
            for n in range(cluster_count)
        )
        return CitationVerification(
            citation_index=index,
            status=status,
            clusters=clusters if status in (200, 300) else (),
        )

    return _verification

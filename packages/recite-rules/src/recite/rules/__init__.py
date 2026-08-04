"""The ReCite rule set.

Rules are grouped by family so that identifiers stay readable in reports and
suppression configs:

===== =========================================================
``RP`` the reporter abbreviation itself
``DT`` the year, checked against reporter publication ranges
``CT`` the court parenthetical
``ST`` how citations relate to one another in the document
``VF`` cross-checks against the CourtListener database
===== =========================================================

Every rule is stateless, so the registry holds one shared instance of each.
"""

from __future__ import annotations

from collections.abc import Iterable, Sequence

from recite.core import Diagnostic

from .base import Rule, RuleContext
from .courts import CourtAbbreviation, CourtDidNotExist, ReporterCourtMismatch
from .dates import ImplausibleYear, YearOutsideEdition
from .reporters import AmbiguousReporter, ReporterFormat, UnrecognizedReporter
from .structure import PinCiteOutOfRange, UnresolvedShortForm
from .verification import (
    AmbiguousAuthority,
    CaseNameMismatch,
    UnknownAuthority,
    YearMismatch,
)

__version__ = "0.1.0"

_REGISTRY: tuple[Rule, ...] = (
    ReporterFormat(),
    AmbiguousReporter(),
    UnrecognizedReporter(),
    YearOutsideEdition(),
    ImplausibleYear(),
    CourtAbbreviation(),
    ReporterCourtMismatch(),
    CourtDidNotExist(),
    UnresolvedShortForm(),
    PinCiteOutOfRange(),
    UnknownAuthority(),
    AmbiguousAuthority(),
    CaseNameMismatch(),
    YearMismatch(),
)

__all__ = [
    "AmbiguousAuthority",
    "AmbiguousReporter",
    "CaseNameMismatch",
    "CourtAbbreviation",
    "CourtDidNotExist",
    "ImplausibleYear",
    "PinCiteOutOfRange",
    "ReporterCourtMismatch",
    "ReporterFormat",
    "Rule",
    "RuleContext",
    "UnknownAuthority",
    "UnrecognizedReporter",
    "UnresolvedShortForm",
    "YearMismatch",
    "YearOutsideEdition",
    "__version__",
    "all_rules",
    "get_rule",
    "run_rules",
    "select_rules",
]


def all_rules() -> tuple[Rule, ...]:
    """Every registered rule, in the order they are reported."""
    return _REGISTRY


def get_rule(identifier: str) -> Rule | None:
    """Look a rule up by id (``"RP001"``) or name (``"reporter-format"``)."""
    wanted = identifier.strip().lower()
    for rule in _REGISTRY:
        if wanted in (rule.id.lower(), rule.name.lower()):
            return rule
    return None


def select_rules(
    *,
    enable: Sequence[str] | None = None,
    disable: Sequence[str] | None = None,
    include_verification: bool = True,
) -> list[Rule]:
    """Filter the registry.

    ``enable`` is an allow-list applied first — when given, only those rules
    are considered. ``disable`` then removes rules from whatever remains, so
    the two can be combined. Both accept ids or names. Unknown identifiers are
    ignored here; the CLI validates them so it can report the typo properly.
    """
    if enable:
        wanted = {e.strip().lower() for e in enable}
        rules = [
            r for r in _REGISTRY if r.id.lower() in wanted or r.name.lower() in wanted
        ]
    else:
        rules = list(_REGISTRY)

    if disable:
        unwanted = {d.strip().lower() for d in disable}
        rules = [
            r
            for r in rules
            if r.id.lower() not in unwanted and r.name.lower() not in unwanted
        ]

    if not include_verification:
        rules = [r for r in rules if not r.requires_verification]

    return rules


def run_rules(
    ctx: RuleContext, rules: Iterable[Rule] | None = None
) -> list[Diagnostic]:
    """Run every rule over one document and return the findings in text order.

    A rule that raises is not allowed to take the run down with it: one broken
    check should cost you that check, not the whole report.
    """
    findings: list[Diagnostic] = []
    for rule in rules if rules is not None else _REGISTRY:
        try:
            findings.extend(rule.check(ctx))
        except Exception as exc:  # pragma: no cover - defensive
            import logging

            logging.getLogger(__name__).warning(
                "rule %s failed and was skipped: %s", rule.id, exc
            )
    return sorted(findings, key=lambda d: d.sort_key())

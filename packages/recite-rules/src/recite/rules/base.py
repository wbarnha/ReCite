"""What a rule is, and what it gets to look at."""

from __future__ import annotations

import datetime as _dt
from abc import ABC, abstractmethod
from collections.abc import Iterable
from dataclasses import dataclass, field

from recite.core import (
    CitationVerification,
    Correction,
    Diagnostic,
    Extraction,
    FixSafety,
    ParsedCitation,
    Severity,
    Span,
)

__all__ = ["Rule", "RuleContext"]


@dataclass
class RuleContext:
    """Everything a rule may consult. Rules must not reach outside it."""

    extraction: Extraction
    verifications: dict[int, CitationVerification] = field(default_factory=dict)
    """Keyed by :attr:`ParsedCitation.index`. Empty when running offline."""

    current_year: int = field(default_factory=lambda: _dt.date.today().year)
    """Injectable so that "is this year in the future?" is testable."""

    @property
    def text(self) -> str:
        return self.extraction.text

    @property
    def citations(self) -> list[ParsedCitation]:
        return self.extraction.citations

    def verification_for(self, citation: ParsedCitation) -> CitationVerification | None:
        return self.verifications.get(citation.index)


class Rule(ABC):
    """One check, producing zero or more diagnostics for a document.

    Subclasses declare their identity as class attributes and implement
    :meth:`check`. Keeping rules stateless means the registry can hold a single
    shared instance of each.
    """

    id: str
    """Stable identifier, e.g. ``"RP001"``. Referenced in configs and SARIF."""

    name: str
    """Short kebab-case name, e.g. ``"reporter-format"``."""

    summary: str
    """One line, shown by ``recite rules``."""

    severity: Severity = Severity.WARNING
    """Default severity; a rule may still emit at a different level."""

    requires_verification: bool = False
    """True for rules that are inert without CourtListener results."""

    @abstractmethod
    def check(self, ctx: RuleContext) -> Iterable[Diagnostic]:
        """Yield a diagnostic for every problem this rule finds."""

    # -- helpers for subclasses -------------------------------------------

    def diagnostic(
        self,
        citation: ParsedCitation,
        message: str,
        *,
        severity: Severity | None = None,
        span: Span | None = None,
        replacement: str | None = None,
        fix_span: Span | None = None,
        safety: FixSafety = FixSafety.UNSAFE,
        fix_description: str | None = None,
        **context: object,
    ) -> Diagnostic:
        """Build a diagnostic, optionally carrying a correction.

        ``span`` defaults to the citation itself, and the correction defaults
        to rewriting that same span — which is what most rules want.
        """
        target = span or citation.span
        correction = None
        if replacement is not None:
            correction = Correction(
                span=fix_span or target,
                replacement=replacement,
                safety=safety,
                description=fix_description or message,
            )
        return Diagnostic(
            rule_id=self.id,
            severity=severity or self.severity,
            message=message,
            span=target,
            citation_text=citation.text,
            correction=correction,
            context=dict(context),
        )

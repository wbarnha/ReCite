"""The vocabulary every ReCite package shares.

Nothing here knows how to find a citation or how to decide whether one is
wrong. These are the nouns: a span of text, a citation parsed out of it, a
complaint about it, and the edit that would resolve the complaint.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from enum import StrEnum
from typing import Any

__all__ = [
    "CitationVerification",
    "Correction",
    "Diagnostic",
    "FixSafety",
    "ParsedCitation",
    "Severity",
    "Span",
    "VerifiedCluster",
]


class Severity(StrEnum):
    """How much a diagnostic should worry the reader."""

    ERROR = "error"
    """The citation is wrong, or points at nothing that exists."""

    WARNING = "warning"
    """The citation is probably wrong, or is non-standard in a way that matters."""

    INFO = "info"
    """Style-level: correct, but not how the Bluebook would write it."""

    @property
    def rank(self) -> int:
        return _SEVERITY_RANK[self]


_SEVERITY_RANK = {Severity.INFO: 0, Severity.WARNING: 1, Severity.ERROR: 2}


class FixSafety(StrEnum):
    """Whether a correction may be applied without a human looking at it."""

    SAFE = "safe"
    """Purely presentational. The authority being pointed at does not change."""

    UNSAFE = "unsafe"
    """Changes which authority is cited, or asserts a fact we merely inferred."""


@dataclass(frozen=True, order=True)
class Span:
    """A half-open ``[start, end)`` character range in a document."""

    start: int
    end: int

    def __post_init__(self) -> None:
        if self.start < 0 or self.end < self.start:
            raise ValueError(f"invalid span: [{self.start}, {self.end})")

    def __len__(self) -> int:
        return self.end - self.start

    def overlaps(self, other: Span) -> bool:
        """True when the two ranges share at least one character.

        Zero-length spans never overlap anything, which keeps pure insertions
        from blocking each other.
        """
        if not len(self) or not len(other):
            return False
        return self.start < other.end and other.start < self.end

    def slice_of(self, text: str) -> str:
        return text[self.start : self.end]

    def as_tuple(self) -> tuple[int, int]:
        return (self.start, self.end)


@dataclass(frozen=True)
class Correction:
    """A replacement for one span of the source document."""

    span: Span
    replacement: str
    safety: FixSafety
    description: str

    def is_noop(self, text: str) -> bool:
        return self.span.slice_of(text) == self.replacement


@dataclass(frozen=True)
class Diagnostic:
    """One complaint about one citation."""

    rule_id: str
    severity: Severity
    message: str
    span: Span
    citation_text: str
    correction: Correction | None = None
    context: dict[str, Any] = field(default_factory=dict)

    @property
    def fixable(self) -> bool:
        return self.correction is not None

    def sort_key(self) -> tuple[int, int, str]:
        return (self.span.start, self.span.end, self.rule_id)


@dataclass(frozen=True)
class VerifiedCluster:
    """One opinion cluster CourtListener matched a citation to."""

    cluster_id: int | None = None
    case_name: str | None = None
    date_filed: str | None = None
    """ISO date, e.g. ``"1973-01-22"``."""

    absolute_url: str | None = None
    citations: tuple[str, ...] = ()
    """Every reporter citation CourtListener knows for this case."""

    @property
    def year(self) -> int | None:
        if self.date_filed and self.date_filed[:4].isdigit():
            return int(self.date_filed[:4])
        return None

    @property
    def url(self) -> str | None:
        if not self.absolute_url:
            return None
        if self.absolute_url.startswith("http"):
            return self.absolute_url
        return f"https://www.courtlistener.com{self.absolute_url}"

    def to_dict(self) -> dict[str, Any]:
        return {
            "cluster_id": self.cluster_id,
            "case_name": self.case_name,
            "date_filed": self.date_filed,
            "url": self.url,
            "citations": list(self.citations),
        }


@dataclass(frozen=True)
class CitationVerification:
    """What the CourtListener citation-lookup API said about one citation.

    ``status`` mirrors the API's per-citation status: ``200`` matched exactly
    one case, ``300`` matched several, ``404`` parsed fine but is in no
    database, ``400`` names a reporter that does not exist, and ``429`` means
    the request exceeded the per-call citation limit and was never looked up.
    """

    citation_index: int
    status: int
    normalized: tuple[str, ...] = ()
    clusters: tuple[VerifiedCluster, ...] = ()
    error_message: str | None = None
    from_cache: bool = False

    @property
    def matched(self) -> bool:
        return self.status == 200 and bool(self.clusters)

    @property
    def ambiguous(self) -> bool:
        return self.status == 300

    @property
    def not_found(self) -> bool:
        return self.status == 404

    @property
    def checked(self) -> bool:
        """False when the API declined to look this one up (e.g. over quota)."""
        return self.status != 429

    def to_dict(self) -> dict[str, Any]:
        return {
            "citation_index": self.citation_index,
            "status": self.status,
            "normalized": list(self.normalized),
            "clusters": [c.to_dict() for c in self.clusters],
            "error_message": self.error_message,
            "from_cache": self.from_cache,
        }


@dataclass
class ParsedCitation:
    """A citation eyecite found, flattened into something easy to reason about.

    ``raw`` keeps the original eyecite object so rules can reach for details
    the flattened view does not carry. Everything else on this class is plain
    data, which is what makes JSON output and caching straightforward.
    """

    index: int
    """Position in document order. Also the stable identifier used by rules."""

    kind: str
    """eyecite class name: ``FullCaseCitation``, ``IdCitation``, and friends."""

    text: str
    """Exactly the characters matched, as they appear in the source."""

    span: Span
    """Span of ``text`` in the source document."""

    full_span: Span
    """Span including case name and the trailing court/year parenthetical."""

    corrected: str
    """eyecite's canonical rendering of the citation proper."""

    volume: str | None = None

    reporter: str | None = None
    """The reporter abbreviation exactly as written, e.g. ``"F. 3d"``."""

    reporter_canonical: str | None = None
    """The edition eyecite matched it to, e.g. ``"F.3d"``."""

    reporter_is_scotus: bool = False
    """True for ``U.S.``, ``S. Ct.``, ``L. Ed.`` and friends."""

    reporter_ambiguous: bool = False
    """True when the abbreviation could belong to more than one series."""

    page: str | None = None
    year: int | None = None
    court_id: str | None = None
    """``courts-db`` id eyecite resolved the parenthetical to, e.g. ``"ca9"``."""

    court_text: str | None = None
    """The court abbreviation as the author typed it, e.g. ``"9th Cir."``."""

    court_text_span: Span | None = None
    """Where :attr:`court_text` sits, so it can be rewritten in place."""

    plaintiff: str | None = None
    defendant: str | None = None
    pin_cite: str | None = None
    parenthetical: str | None = None
    antecedent_guess: str | None = None

    resource_key: str | None = None
    """Groups short forms, ``Id.`` and ``supra`` with the full cite they mean.

    ``None`` means eyecite could not tie this reference to any earlier
    authority, which is itself a finding.
    """

    raw: Any = field(default=None, repr=False, compare=False)

    # -- convenience ------------------------------------------------------

    @property
    def is_full(self) -> bool:
        return self.kind.startswith("Full")

    @property
    def is_short_form(self) -> bool:
        return self.kind in {
            "IdCitation",
            "ReferenceCitation",
            "ShortCaseCitation",
            "SupraCitation",
        }

    @property
    def case_name(self) -> str | None:
        if self.plaintiff and self.defendant:
            return f"{self.plaintiff} v. {self.defendant}"
        return self.defendant or self.plaintiff

    @property
    def lookup_key(self) -> str | None:
        """``"410 U.S. 113"`` — the canonical form used for cache keys."""
        if self.volume and self.reporter and self.page:
            return f"{self.volume} {self.reporter} {self.page}"
        return None

    @property
    def lookup_parts(self) -> tuple[str, str, str] | None:
        """``(volume, reporter, page)`` in canonical form, for structured lookups."""
        reporter = self.reporter_canonical or self.reporter
        if self.volume and reporter and self.page:
            return (self.volume, reporter, self.page)
        return None

    def to_dict(self) -> dict[str, Any]:
        return {
            "index": self.index,
            "kind": self.kind,
            "text": self.text,
            "span": list(self.span.as_tuple()),
            "full_span": list(self.full_span.as_tuple()),
            "corrected": self.corrected,
            "volume": self.volume,
            "reporter": self.reporter,
            "reporter_canonical": self.reporter_canonical,
            "page": self.page,
            "year": self.year,
            "court_id": self.court_id,
            "court_text": self.court_text,
            "case_name": self.case_name,
            "pin_cite": self.pin_cite,
            "parenthetical": self.parenthetical,
            "resource_key": self.resource_key,
        }

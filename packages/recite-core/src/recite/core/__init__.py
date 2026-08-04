"""Shared model, extraction and reference data for ReCite."""

from .courts import CourtInfo, court_citation_string, court_info, resolve_court
from .extract import Extraction, extract
from .models import (
    CitationVerification,
    Correction,
    Diagnostic,
    FixSafety,
    ParsedCitation,
    Severity,
    Span,
    VerifiedCluster,
)
from .reporters import (
    EditionInfo,
    canonical_editions_for_variation,
    differs_only_cosmetically,
    edition_info,
    editions_covering_year,
    is_known_edition,
    is_variation,
    series_editions,
    suggest_editions,
)
from .text import PatchResult, apply_corrections, line_col, snippet, unified_diff

__version__ = "0.1.0"

__all__ = [
    "CitationVerification",
    "Correction",
    "CourtInfo",
    "Diagnostic",
    "EditionInfo",
    "Extraction",
    "FixSafety",
    "ParsedCitation",
    "PatchResult",
    "Severity",
    "Span",
    "VerifiedCluster",
    "__version__",
    "apply_corrections",
    "canonical_editions_for_variation",
    "court_citation_string",
    "court_info",
    "differs_only_cosmetically",
    "edition_info",
    "editions_covering_year",
    "extract",
    "is_known_edition",
    "is_variation",
    "line_col",
    "resolve_court",
    "series_editions",
    "snippet",
    "suggest_editions",
    "unified_diff",
]

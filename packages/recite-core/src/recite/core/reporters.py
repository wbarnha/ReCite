"""Queries against ``reporters-db``.

``reporters-db`` ships three indexes that matter to us:

``REPORTERS``
    Keyed by a series root (``"F."``), each entry lists its ``editions``
    (``F.``, ``F.2d``, ``F.3d``, ``F.4th``) with the date range each covers.
``EDITIONS``
    Flat map of edition name -> series root, so ``"F.3d" -> "F."``.
``VARIATIONS_ONLY``
    Flat map of a mis-spelling or older abbreviation -> the edition(s) it
    could mean, so ``"F. 3d" -> ["F.3d"]``.

Everything below is a read-only view over those, plus a fuzzy matcher for
reporter tokens that appear in none of them.
"""

from __future__ import annotations

import datetime as _dt
import difflib
import re
from dataclasses import dataclass
from functools import lru_cache

from reporters_db import EDITIONS, REPORTERS, VARIATIONS_ONLY

__all__ = [
    "EditionInfo",
    "canonical_editions_for_variation",
    "differs_only_cosmetically",
    "edition_info",
    "editions_covering_year",
    "is_known_edition",
    "is_variation",
    "normalize_reporter_token",
    "series_editions",
    "suggest_editions",
]

_WHITESPACE = re.compile(r"\s+")


@dataclass(frozen=True)
class EditionInfo:
    """One edition of one reporter series, with the years it covers."""

    name: str
    """Canonical short name, e.g. ``"F.3d"``."""

    series: str
    """Series root as keyed in ``REPORTERS``, e.g. ``"F."``."""

    reporter_name: str
    """Human-readable name, e.g. ``"Federal Reporter"``."""

    cite_type: str
    """``"federal"``, ``"state"``, ``"state_regional"``, ``"neutral"``, ..."""

    start_year: int | None
    end_year: int | None

    @property
    def is_current(self) -> bool:
        return self.end_year is None

    def covers(self, year: int) -> bool:
        if self.start_year is not None and year < self.start_year:
            return False
        return not (self.end_year is not None and year > self.end_year)

    def coverage_label(self) -> str:
        if self.start_year is None and self.end_year is None:
            return "all years"
        start = str(self.start_year) if self.start_year is not None else "?"
        end = str(self.end_year) if self.end_year is not None else "present"
        return f"{start}–{end}"


def _year_of(value: object) -> int | None:
    if isinstance(value, _dt.datetime):
        return value.year
    if isinstance(value, _dt.date):
        return value.year
    if isinstance(value, str) and value[:4].isdigit():
        return int(value[:4])
    return None


@lru_cache(maxsize=1)
def _edition_index() -> dict[str, EditionInfo]:
    """Build ``edition name -> EditionInfo`` once, for every known reporter."""
    index: dict[str, EditionInfo] = {}
    for series, entries in REPORTERS.items():
        for entry in entries:
            for name, dates in entry.get("editions", {}).items():
                index[name] = EditionInfo(
                    name=name,
                    series=series,
                    reporter_name=entry.get("name", series),
                    cite_type=entry.get("cite_type", "unknown"),
                    start_year=_year_of(dates.get("start")),
                    end_year=_year_of(dates.get("end")),
                )
    return index


def normalize_reporter_token(token: str) -> str:
    """Collapse the whitespace noise OCR leaves behind (``"U. S."`` stays as-is).

    This only tidies runs of whitespace; it deliberately does not remove
    spaces, because ``"U. S."`` and ``"U.S."`` are different strings that
    ``VARIATIONS_ONLY`` distinguishes.
    """
    return _WHITESPACE.sub(" ", token).strip()


def edition_info(name: str) -> EditionInfo | None:
    """Look up an edition by its canonical short name."""
    return _edition_index().get(normalize_reporter_token(name))


def is_known_edition(name: str) -> bool:
    return normalize_reporter_token(name) in EDITIONS


def _variation_spellings(token: str) -> tuple[str, ...]:
    """The forms of ``token`` worth looking up in ``VARIATIONS_ONLY``.

    eyecite's reporter patterns treat internal whitespace as optional, so it
    reports ``"Fed. Rep."`` for text that ``reporters-db`` indexes under
    ``"Fed.Rep."``. Checking the un-spaced spelling too keeps the two in sync.
    """
    spaced = normalize_reporter_token(token)
    unspaced = spaced.replace(" ", "")
    return (spaced,) if spaced == unspaced else (spaced, unspaced)


def is_variation(token: str) -> bool:
    """True when ``token`` is a recognised *mis*-spelling, not a canonical name."""
    spellings = _variation_spellings(token)
    if normalize_reporter_token(token) in EDITIONS:
        return False
    return any(s in VARIATIONS_ONLY for s in spellings)


def _squash(token: str) -> str:
    """Reduce an abbreviation to its identifying letters and digits."""
    return "".join(ch for ch in token.lower() if ch.isalnum())


def differs_only_cosmetically(written: str, canonical: str) -> bool:
    """Whether two abbreviations differ only in spacing and punctuation.

    ``"U. S."``, ``"US"`` and ``"U.S."`` all squash to ``"us"``, so writing any
    of them is a typographic slip. ``"Fed. Rep."`` squashes to ``"fedrep"``
    against ``"F."``'s ``"f"``, which is a substantively different
    abbreviation — the sort of thing worth more than a shrug in a report.
    """
    return _squash(written) == _squash(canonical)


def canonical_editions_for_variation(token: str) -> list[str]:
    """Canonical edition names a variation could stand for (often just one)."""
    for spelling in _variation_spellings(token):
        if spelling in VARIATIONS_ONLY:
            return list(VARIATIONS_ONLY[spelling])
    return []


def series_editions(name: str) -> list[EditionInfo]:
    """Every edition in the same series as ``name``, oldest first.

    ``series_editions("F.3d")`` returns ``F.``, ``F.2d``, ``F.3d``, ``F.4th``,
    which is what lets us say "1950 is F.2d territory, not F.3d".
    """
    info = edition_info(name)
    if info is None:
        return []
    siblings = [e for e in _edition_index().values() if e.series == info.series]
    return sorted(siblings, key=lambda e: (e.start_year or 0, e.name))


def editions_covering_year(name: str, year: int) -> list[EditionInfo]:
    """Editions of ``name``'s series whose date range includes ``year``."""
    return [e for e in series_editions(name) if e.covers(year)]


def suggest_editions(token: str, limit: int = 3, cutoff: float = 0.75) -> list[str]:
    """Closest known reporter abbreviations to an unrecognised token.

    Matches against canonical editions *and* known variations, so a typo of a
    variation ("Fed. Rep") still leads somewhere useful. The caller decides
    whether a suggestion is strong enough to act on.
    """
    token = normalize_reporter_token(token)
    if not token:
        return []
    candidates = set(EDITIONS) | set(VARIATIONS_ONLY)
    matches = difflib.get_close_matches(token, candidates, n=limit * 2, cutoff=cutoff)

    # Collapse variations onto the edition they mean, preserving match order.
    seen: list[str] = []
    for match in matches:
        for canonical in [match] if match in EDITIONS else VARIATIONS_ONLY[match]:
            if canonical not in seen:
                seen.append(canonical)
    return seen[:limit]

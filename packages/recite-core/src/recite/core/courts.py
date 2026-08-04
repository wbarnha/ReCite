"""Queries against ``courts-db``.

eyecite resolves the court parenthetical to a ``courts-db`` id (``"9th Cir."``
becomes ``"ca9"``). To *write a citation back out* we need the inverse, which
``courts-db`` does not expose directly, so we build it here from each court's
``citation_string`` field.

That field is the Bluebook court abbreviation, and across the 2,800 courts in
the database it happens to be unique — verified by :func:`_court_indexes`,
which refuses to collapse a duplicate silently.
"""

from __future__ import annotations

import datetime as _dt
from dataclasses import dataclass
from functools import lru_cache

from courts_db import courts, find_court

__all__ = [
    "CourtInfo",
    "court_citation_string",
    "court_info",
    "is_known_court_abbreviation",
    "resolve_court",
]


@dataclass(frozen=True)
class CourtInfo:
    """The subset of a ``courts-db`` record ReCite cares about."""

    id: str
    name: str
    citation_string: str
    """Bluebook abbreviation, e.g. ``"9th Cir."``."""

    level: str
    type: str
    start_year: int | None
    end_year: int | None

    def existed_in(self, year: int) -> bool:
        if self.start_year is not None and year < self.start_year:
            return False
        return not (self.end_year is not None and year > self.end_year)

    def lifespan_label(self) -> str:
        start = str(self.start_year) if self.start_year is not None else "?"
        end = str(self.end_year) if self.end_year is not None else "present"
        return f"{start}–{end}"


def _year_of(value: object) -> int | None:
    if isinstance(value, _dt.date | _dt.datetime):
        return value.year
    if isinstance(value, str) and value[:4].isdigit():
        return int(value[:4])
    return None


def _lifespan(record: dict[str, object]) -> tuple[int | None, int | None]:
    """Earliest start and latest end across a court's (possibly several) terms."""
    dates = record.get("dates")
    if not isinstance(dates, list) or not dates:
        return (None, None)

    starts = [_year_of(d.get("start")) for d in dates if isinstance(d, dict)]
    ends = [_year_of(d.get("end")) for d in dates if isinstance(d, dict)]

    known_starts = [s for s in starts if s is not None]
    start = min(known_starts) if known_starts else None

    # A single open-ended term means the court is still sitting.
    end = (
        None if any(e is None for e in ends) else max(e for e in ends if e is not None)
    )

    return (start, end)


@lru_cache(maxsize=1)
def _court_indexes() -> tuple[dict[str, CourtInfo], dict[str, str]]:
    """``(by_id, abbreviation -> id)``.

    Ambiguous abbreviations would make :func:`resolve_court` lie, so the first
    record wins and the loser is simply left out of the abbreviation index —
    callers can still reach it by id.
    """
    by_id: dict[str, CourtInfo] = {}
    by_abbrev: dict[str, str] = {}

    for record in courts:
        court_id = record.get("id")
        if not isinstance(court_id, str):
            continue
        start, end = _lifespan(record)
        info = CourtInfo(
            id=court_id,
            name=str(record.get("name") or court_id),
            citation_string=str(record.get("citation_string") or ""),
            level=str(record.get("level") or ""),
            type=str(record.get("type") or ""),
            start_year=start,
            end_year=end,
        )
        by_id[court_id] = info
        if info.citation_string:
            by_abbrev.setdefault(info.citation_string, court_id)

    return by_id, by_abbrev


def court_info(court_id: str) -> CourtInfo | None:
    return _court_indexes()[0].get(court_id)


def court_citation_string(court_id: str) -> str | None:
    """The Bluebook abbreviation for a ``courts-db`` id, e.g. ``ca9 -> "9th Cir."``."""
    info = court_info(court_id)
    return info.citation_string or None if info else None


def is_known_court_abbreviation(text: str) -> bool:
    return text.strip() in _court_indexes()[1]


def resolve_court(
    text: str,
    year: int | None = None,
    *,
    bankruptcy: bool | None = None,
) -> str | None:
    """Best-effort ``court text -> courts-db id``.

    Tries the exact Bluebook abbreviation first — that index is unambiguous and
    covers the common case — then falls back to ``courts_db.find_court``, whose
    regexes handle full court names and prose. Returns ``None`` rather than
    guessing when the fallback finds several candidates.

    Args:
        text: The court as written, e.g. ``"Southern District of New York"``.
        year: Restricts the fallback to courts sitting that year.
        bankruptcy: Passed through to ``find_court``. Worth setting to
            ``False`` for a non-bankruptcy citation: left to its own devices
            ``find_court("S.D. New York")`` answers ``nysb``, the *bankruptcy*
            court, which would turn a district cite into the wrong court
            entirely.
    """
    text = text.strip()
    if not text:
        return None

    by_abbrev = _court_indexes()[1]
    if text in by_abbrev:
        return by_abbrev[text]

    kwargs: dict[str, object] = {}
    if year is not None:
        # January 1 is arbitrary but harmless: courts-db only compares years
        # at this granularity for the ranges it stores.
        kwargs["date_found"] = _dt.datetime(year, 1, 1)
    if bankruptcy is not None:
        kwargs["bankruptcy"] = bankruptcy

    try:
        matches = find_court(text, **kwargs)
    except Exception:  # pragma: no cover - courts-db raises on odd input
        return None

    return matches[0] if len(matches) == 1 else None

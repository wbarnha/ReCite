"""Editing documents by span, without ever corrupting one.

Corrections arrive from many independent rules and refer to offsets in the
*original* text. Applying them naively in document order would invalidate every
offset after the first edit, and two rules that both want to rewrite the same
citation would silently produce nonsense.

:func:`apply_corrections` therefore applies edits back-to-front and refuses any
correction that overlaps one it already accepted, reporting the rejects instead
of dropping them.
"""

from __future__ import annotations

import difflib
from dataclasses import dataclass, field

from .models import Correction, Span

__all__ = ["PatchResult", "apply_corrections", "line_col", "unified_diff"]


@dataclass
class PatchResult:
    """Outcome of applying a batch of corrections to one document."""

    text: str
    """The patched document."""

    applied: list[Correction] = field(default_factory=list)
    skipped: list[tuple[Correction, str]] = field(default_factory=list)
    """``(correction, reason)`` for each edit that was not applied."""

    @property
    def changed(self) -> bool:
        return bool(self.applied)


def apply_corrections(text: str, corrections: list[Correction]) -> PatchResult:
    """Apply non-overlapping corrections to ``text``.

    Corrections are considered in document order so that when two of them
    collide, the earlier one wins — that keeps the result stable regardless of
    which rule happened to run first. No-ops (a replacement identical to what
    is already there) are dropped quietly, since a rule proposing one is not an
    error, just redundant.
    """
    ordered = sorted(corrections, key=lambda c: (c.span.start, c.span.end))

    accepted: list[Correction] = []
    skipped: list[tuple[Correction, str]] = []

    for correction in ordered:
        if correction.span.end > len(text):
            skipped.append((correction, "span extends past end of document"))
            continue
        if correction.is_noop(text):
            skipped.append((correction, "replacement is identical to source"))
            continue
        clash = next(
            (a for a in accepted if a.span.overlaps(correction.span)),
            None,
        )
        if clash is not None:
            skipped.append(
                (correction, f"overlaps an earlier fix at {clash.span.as_tuple()}")
            )
            continue
        accepted.append(correction)

    patched = text
    for correction in sorted(accepted, key=lambda c: c.span.start, reverse=True):
        patched = (
            patched[: correction.span.start]
            + correction.replacement
            + patched[correction.span.end :]
        )

    return PatchResult(text=patched, applied=accepted, skipped=skipped)


def line_col(text: str, offset: int) -> tuple[int, int]:
    """1-based ``(line, column)`` for a character offset.

    Used for human-readable output and for SARIF, both of which count from 1.
    """
    if offset < 0:
        raise ValueError("offset must be non-negative")
    offset = min(offset, len(text))
    line = text.count("\n", 0, offset) + 1
    line_start = text.rfind("\n", 0, offset) + 1
    return line, offset - line_start + 1


def unified_diff(before: str, after: str, path: str = "document") -> str:
    """A standard unified diff, empty when nothing changed."""
    if before == after:
        return ""
    diff = difflib.unified_diff(
        before.splitlines(keepends=True),
        after.splitlines(keepends=True),
        fromfile=f"a/{path}",
        tofile=f"b/{path}",
        n=2,
    )
    return "".join(diff)


def snippet(text: str, span: Span, width: int = 60) -> str:
    """One line of context around ``span``, for terminal output."""
    start = max(0, span.start - width // 2)
    end = min(len(text), span.end + width // 2)
    fragment = text[start:end].replace("\n", " ").strip()
    prefix = "…" if start > 0 else ""
    suffix = "…" if end < len(text) else ""
    return f"{prefix}{fragment}{suffix}"

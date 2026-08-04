"""Span arithmetic and patching — the part that must never corrupt a document."""

from __future__ import annotations

import pytest

from recite.core import Correction, FixSafety, Span, apply_corrections, unified_diff
from recite.core.text import line_col, snippet


def correction(start: int, end: int, replacement: str) -> Correction:
    return Correction(
        span=Span(start, end),
        replacement=replacement,
        safety=FixSafety.SAFE,
        description="test",
    )


class TestSpan:
    def test_rejects_inverted_span(self):
        with pytest.raises(ValueError):
            Span(5, 2)

    def test_rejects_negative_start(self):
        with pytest.raises(ValueError):
            Span(-1, 4)

    @pytest.mark.parametrize(
        ("a", "b", "expected"),
        [
            ((0, 5), (3, 8), True),
            ((0, 5), (5, 8), False),  # touching, not overlapping
            ((0, 5), (6, 8), False),
            ((2, 4), (0, 10), True),
        ],
    )
    def test_overlaps(self, a, b, expected):
        assert Span(*a).overlaps(Span(*b)) is expected
        assert Span(*b).overlaps(Span(*a)) is expected

    def test_zero_length_spans_never_overlap(self):
        # Insertions must not block one another.
        assert not Span(3, 3).overlaps(Span(0, 10))


class TestApplyCorrections:
    def test_applies_in_reverse_so_offsets_stay_valid(self):
        text = "one two three"
        result = apply_corrections(
            text, [correction(0, 3, "ONE"), correction(8, 13, "THREE")]
        )
        assert result.text == "ONE two THREE"
        assert len(result.applied) == 2

    def test_later_overlapping_correction_is_skipped_not_applied(self):
        text = "123 F. 3d 456"
        result = apply_corrections(
            text,
            [correction(0, 13, "123 F.3d 456"), correction(4, 9, "F.3d")],
        )
        assert result.text == "123 F.3d 456"
        assert len(result.applied) == 1
        assert len(result.skipped) == 1
        assert "overlaps" in result.skipped[0][1]

    def test_earlier_correction_wins_regardless_of_input_order(self):
        text = "abcdefgh"
        forward = apply_corrections(
            text, [correction(0, 4, "W"), correction(2, 6, "X")]
        )
        reverse = apply_corrections(
            text, [correction(2, 6, "X"), correction(0, 4, "W")]
        )
        assert forward.text == reverse.text == "Wefgh"

    def test_noop_correction_is_skipped(self):
        result = apply_corrections("hello", [correction(0, 5, "hello")])
        assert not result.applied
        assert "identical" in result.skipped[0][1]

    def test_correction_past_end_of_document_is_rejected(self):
        result = apply_corrections("short", [correction(0, 99, "x")])
        assert result.text == "short"
        assert "past end" in result.skipped[0][1]

    def test_empty_correction_list_leaves_text_alone(self):
        result = apply_corrections("unchanged", [])
        assert result.text == "unchanged"
        assert not result.changed


class TestLineCol:
    @pytest.mark.parametrize(
        ("offset", "expected"),
        [(0, (1, 1)), (3, (1, 4)), (4, (2, 1)), (7, (2, 4))],
    )
    def test_positions(self, offset, expected):
        assert line_col("abc\ndef\nghi", offset) == expected

    def test_offset_past_end_clamps(self):
        assert line_col("abc", 99) == (1, 4)

    def test_negative_offset_raises(self):
        with pytest.raises(ValueError):
            line_col("abc", -1)


def test_unified_diff_is_empty_when_nothing_changed():
    assert unified_diff("same", "same") == ""


def test_unified_diff_reports_the_change():
    diff = unified_diff("a\nb\n", "a\nc\n", path="brief.txt")
    assert "-b" in diff
    assert "+c" in diff
    assert "brief.txt" in diff


def test_snippet_collapses_newlines_and_marks_truncation():
    text = "x" * 100 + "\ncitation\n" + "y" * 100
    out = snippet(text, Span(101, 109))
    assert "\n" not in out
    assert out.startswith("…") and out.endswith("…")

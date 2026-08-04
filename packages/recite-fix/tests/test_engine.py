"""End-to-end behaviour of the check/fix pipeline."""

from __future__ import annotations

import pytest

from recite.core import FixSafety, Severity
from recite.fix import Engine

BRIEF = """\
Bell Atl. Corp. v. Twombly, 550 US 544, 570 (2007).
Smith v. Jones, 123 F. 3d 456 (9th Cir. 1997).
Delta v. Epsilon, 999 F.3d 1 (2d Cir. 1950).
"""


@pytest.fixture
def engine():
    return Engine(current_year=2026)


class TestCheck:
    def test_reports_findings_in_document_order(self, engine):
        result = engine.check_text(BRIEF, "brief.txt")
        starts = [d.span.start for d in result.diagnostics]
        assert starts == sorted(starts)

    def test_a_clean_document_reports_nothing(self, engine):
        result = engine.check_text("Roe v. Wade, 410 U.S. 113, 116 (1973).")
        assert result.ok
        assert result.error_count == 0

    def test_counts_are_grouped_by_severity(self, engine):
        counts = engine.check_text(BRIEF).counts()
        assert counts[Severity.ERROR] >= 1
        assert sum(counts.values()) == len(engine.check_text(BRIEF).diagnostics)

    def test_an_empty_document_is_handled(self, engine):
        assert engine.check_text("").ok

    def test_the_text_on_the_result_is_what_spans_index_into(self, engine):
        result = engine.check_text(BRIEF, "brief.txt")
        for diagnostic in result.diagnostics:
            assert diagnostic.span.end <= len(result.text)

    def test_verification_rules_are_dropped_when_offline(self, engine):
        assert not any(rule.requires_verification for rule in engine.rules)

    def test_reading_a_file(self, engine, tmp_path):
        path = tmp_path / "brief.txt"
        path.write_text(BRIEF, encoding="utf-8")
        assert engine.check_file(path).path == str(path)


class TestFix:
    def test_safe_fixes_only_by_default(self, engine):
        result = engine.fix_text(BRIEF)
        assert all(c.safety is FixSafety.SAFE for c in result.applied)
        assert "550 U.S. 544" in result.fixed_text
        assert "123 F.3d 456" in result.fixed_text
        # The 1950 F.3d citation needs a judgement call, so it is left alone.
        assert "999 F.3d 1" in result.fixed_text

    def test_unsafe_fixes_are_applied_on_request(self, engine):
        result = engine.fix_text(BRIEF, unsafe=True)
        assert "999 F.2d 1" in result.fixed_text

    def test_fixing_is_idempotent(self, engine):
        once = engine.fix_text(BRIEF).fixed_text
        twice = engine.fix_text(once).fixed_text
        assert once == twice

    def test_the_fixed_document_has_fewer_problems(self, engine):
        before = len(engine.check_text(BRIEF).diagnostics)
        after = len(engine.check_text(engine.fix_text(BRIEF).fixed_text).diagnostics)
        assert after < before

    def test_nothing_outside_the_citations_is_touched(self, engine):
        text = (
            "The court held, in Smith v. Jones, 123 F. 3d 456 (9th Cir. 1997), that x."
        )
        fixed = engine.fix_text(text).fixed_text
        assert fixed.startswith("The court held, in Smith v. Jones,")
        assert fixed.endswith("(9th Cir. 1997), that x.")

    def test_a_clean_document_is_returned_unchanged(self, engine):
        text = "Roe v. Wade, 410 U.S. 113, 116 (1973)."
        result = engine.fix_text(text)
        assert not result.changed
        assert result.diff() == ""

    def test_the_diff_describes_the_change(self, engine):
        diff = engine.fix_text(BRIEF, "brief.txt").diff()
        assert "-Bell Atl. Corp. v. Twombly, 550 US 544, 570 (2007)." in diff
        assert "+Bell Atl. Corp. v. Twombly, 550 U.S. 544, 570 (2007)." in diff

    def test_writing_is_opt_in(self, engine, tmp_path):
        path = tmp_path / "brief.txt"
        path.write_text(BRIEF, encoding="utf-8")

        engine.fix_file(path)
        assert path.read_text(encoding="utf-8") == BRIEF

        engine.fix_file(path, write=True)
        assert path.read_text(encoding="utf-8") != BRIEF

    def test_remaining_lists_what_a_human_still_has_to_read(self, engine):
        result = engine.fix_text(BRIEF)
        assert any(d.rule_id == "DT001" for d in result.remaining)


class TestRuleSelection:
    def test_only_the_selected_rules_run(self):
        from recite.rules import select_rules

        engine = Engine(rules=select_rules(enable=["RP001"]), current_year=2026)
        assert {d.rule_id for d in engine.check_text(BRIEF).diagnostics} == {"RP001"}

    def test_an_ignored_rule_is_silent(self):
        from recite.rules import select_rules

        engine = Engine(rules=select_rules(disable=["RP001"]), current_year=2026)
        assert "RP001" not in {d.rule_id for d in engine.check_text(BRIEF).diagnostics}


class TestOverlappingFixes:
    def test_conflicting_corrections_never_corrupt_the_text(self):
        """Two rules wanting the same citation must not both rewrite it."""
        text = "A v. B, 999 F. 3d 1 (2d Cir. 1950)."
        engine = Engine(current_year=2026)
        result = engine.fix_text(text, unsafe=True)

        # RP001 wants "999 F.3d 1"; DT001 wants "999 F.2d 1". Exactly one wins,
        # and the losing correction is reported rather than silently dropped.
        assert result.fixed_text.count("999 F.") == 1
        assert len(result.applied) == 1
        assert len(result.skipped) == 1
        assert "overlaps" in result.skipped[0][1]

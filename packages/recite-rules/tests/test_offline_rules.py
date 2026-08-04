"""The rule families that need no network: RP, DT, CT, ST."""

from __future__ import annotations

import pytest

from recite.core import FixSafety, Severity
from recite.rules import (
    AmbiguousReporter,
    CourtAbbreviation,
    CourtDidNotExist,
    ImplausibleYear,
    PinCiteOutOfRange,
    ReporterCourtMismatch,
    ReporterFormat,
    UnrecognizedReporter,
    UnresolvedShortForm,
    YearOutsideEdition,
)


def ids(diagnostics):
    return [d.rule_id for d in diagnostics]


class TestReporterFormat:
    def test_misspacing_is_a_safe_fix(self, check):
        (found,) = check("A v. B, 123 F. 3d 4 (9th Cir. 1997).", ReporterFormat())
        assert found.severity is Severity.INFO
        assert found.correction is not None
        assert found.correction.safety is FixSafety.SAFE
        assert found.correction.replacement == "123 F.3d 4"

    def test_a_different_abbreviation_is_a_warning(self, check):
        (found,) = check("A v. B, 12 Fed. Rep. 34 (1882).", ReporterFormat())
        assert found.severity is Severity.WARNING
        assert found.correction.replacement == "12 F. 34"

    def test_missing_periods_are_cosmetic(self, check):
        (found,) = check("A v. B, 550 US 544 (2007).", ReporterFormat())
        assert found.severity is Severity.INFO
        assert found.correction.replacement == "550 U.S. 544"

    def test_a_correct_citation_is_left_alone(self, check):
        assert check("A v. B, 410 U.S. 113 (1973).", ReporterFormat()) == []

    def test_the_fix_actually_produces_the_canonical_text(self, check):
        text = "A v. B, 123 F. 3d 4 (9th Cir. 1997)."
        (found,) = check(text, ReporterFormat())
        span = found.correction.span
        patched = text[: span.start] + found.correction.replacement + text[span.end :]
        assert patched == "A v. B, 123 F.3d 4 (9th Cir. 1997)."


class TestUnrecognizedReporter:
    def test_a_typo_is_flagged_with_a_suggestion(self, check):
        (found,) = check(
            "A v. B, 12 Cal. Rprt. 3d 45 (Cal. Ct. App. 2004).", UnrecognizedReporter()
        )
        assert found.severity is Severity.ERROR
        assert found.correction.replacement == "Cal. Rptr. 3d"
        assert found.correction.safety is FixSafety.UNSAFE

    def test_the_fix_targets_only_the_reporter_token(self, check):
        text = "A v. B, 12 Cal. Rprt. 3d 45 (Cal. Ct. App. 2004)."
        (found,) = check(text, UnrecognizedReporter())
        assert found.correction.span.slice_of(text) == "Cal. Rprt. 3d"

    def test_a_real_citation_is_not_flagged(self, check):
        assert check("A v. B, 410 U.S. 113 (1973).", UnrecognizedReporter()) == []

    def test_a_line_wrapped_citation_is_not_called_unknown(self, check):
        # PDF extraction routinely splits a citation across lines. eyecite
        # misses it, but "U. S." is a perfectly real reporter.
        text = "Ashcroft v. Iqbal, 556 U. S.\n662, 678 (2009)."
        assert check(text, UnrecognizedReporter()) == []

    def test_nonsense_reporter_with_no_close_match_is_ignored(self, check):
        assert check("A v. B, 100 Zzz. 200 (2001).", UnrecognizedReporter()) == []

    def test_numbers_in_prose_are_not_mistaken_for_citations(self, check):
        text = "The 12 exhibits span 300 pages and 42 depositions were taken."
        assert check(text, UnrecognizedReporter()) == []


class TestYearOutsideEdition:
    def test_year_before_the_series_existed(self, check):
        (found,) = check("A v. B, 999 F.3d 1 (2d Cir. 1950).", YearOutsideEdition())
        assert found.severity is Severity.ERROR
        assert "1993" in found.message
        assert found.correction.replacement == "999 F.2d 1"
        assert found.correction.safety is FixSafety.UNSAFE

    def test_year_after_the_series_closed(self, check):
        (found,) = check(
            "A v. B, 700 F. Supp. 1200 (S.D.N.Y. 1990).", YearOutsideEdition()
        )
        assert found.context["suggestion"] == "F. Supp. 2d"

    def test_a_year_inside_the_range_passes(self, check):
        assert check("A v. B, 123 F.3d 4 (9th Cir. 1997).", YearOutsideEdition()) == []

    def test_no_year_means_nothing_to_check(self, check):
        assert check("The court cited 123 F.3d 4 there.", YearOutsideEdition()) == []


class TestImplausibleYear:
    def test_a_future_year_is_an_error(self, check):
        (found,) = check(
            "A v. B, 5 F.4th 9 (1st Cir. 2099).", ImplausibleYear(), current_year=2026
        )
        assert found.severity is Severity.ERROR
        assert "future" in found.message

    def test_this_year_is_fine(self, check):
        assert (
            check(
                "A v. B, 5 F.4th 9 (1st Cir. 2026).",
                ImplausibleYear(),
                current_year=2026,
            )
            == []
        )

    def test_no_fix_is_offered_because_none_can_be_known(self, check):
        (found,) = check("A v. B, 5 F.4th 9 (1st Cir. 2099).", ImplausibleYear())
        assert found.correction is None


class TestCourtRules:
    def test_a_spelled_out_court_gets_abbreviated(self, check):
        text = "A v. B, 700 F. Supp. 1 (Southern District of New York 1990)."
        (found,) = check(text, CourtAbbreviation())
        assert found.correction.replacement == "S.D.N.Y."
        assert found.correction.span.slice_of(text) == "Southern District of New York"

    def test_a_canonical_abbreviation_is_left_alone(self, check):
        assert check("A v. B, 123 F.3d 4 (9th Cir. 1997).", CourtAbbreviation()) == []

    def test_supreme_court_parentheticals_are_left_alone(self, check):
        # courts-db spells scotus "SCOTUS", which is not how a citation reads.
        assert check("A v. B, 410 U.S. 113 (1973).", CourtAbbreviation()) == []

    def test_a_non_court_parenthetical_is_left_alone(self, check):
        assert check("A v. B, 1 F.3d 1 (per curiam).", CourtAbbreviation()) == []

    def test_scotus_reporter_with_a_circuit_court_is_an_error(self, check):
        (found,) = check("A v. B, 200 U.S. 1 (9th Cir. 1906).", ReporterCourtMismatch())
        assert found.severity is Severity.ERROR
        assert found.correction is None

    def test_scotus_reporter_with_scotus_is_fine(self, check):
        assert check("A v. B, 410 U.S. 113 (1973).", ReporterCourtMismatch()) == []

    def test_a_court_cited_before_it_existed(self, check):
        # The Ninth Circuit was created in 1891.
        (found,) = check("A v. B, 1 F. 1 (9th Cir. 1880).", CourtDidNotExist())
        assert found.severity is Severity.WARNING
        assert "1891" in found.message


class TestStructure:
    def test_supra_without_an_antecedent(self, check):
        (found,) = check("As held in Ghost Corp., supra, at 3.", UnresolvedShortForm())
        assert found.severity is Severity.ERROR

    def test_id_following_a_full_citation_is_fine(self, check):
        assert (
            check("A v. B, 410 U.S. 113 (1973). Id. at 116.", UnresolvedShortForm())
            == []
        )

    def test_pin_cite_before_the_first_page(self, check):
        (found,) = check("A v. B, 410 U.S. 113, 99 (1973).", PinCiteOutOfRange())
        assert found.severity is Severity.WARNING
        assert found.context == {"pin_cite": 99, "first_page": 113}

    def test_pin_cite_after_the_first_page_is_fine(self, check):
        assert check("A v. B, 410 U.S. 113, 116 (1973).", PinCiteOutOfRange()) == []

    def test_short_form_pin_cite_is_checked_against_its_antecedent(self, check):
        text = "A v. B, 410 U.S. 113 (1973). See B, 410 U.S. at 99."
        assert "ST002" in ids(check(text, PinCiteOutOfRange()))


class TestAmbiguousReporter:
    def test_an_ambiguous_abbreviation_is_reported(self, check):
        found = check("A v. B, 2 B.R. 3 (Bankr. S.D.N.Y. 1990).", AmbiguousReporter())
        assert ids(found) == ["RP002"]

    def test_an_unambiguous_reporter_is_not(self, check):
        assert check("A v. B, 410 U.S. 113 (1973).", AmbiguousReporter()) == []


class TestWholeRuleSet:
    def test_a_clean_citation_produces_nothing(self, check):
        assert check("Roe v. Wade, 410 U.S. 113, 116 (1973). Id. at 120.") == []

    def test_diagnostics_come_back_in_document_order(self, check):
        text = (
            "A v. B, 550 US 544 (2007). C v. D, 999 F.3d 1 (2d Cir. 1950). "
            "E v. F, 200 U.S. 1 (9th Cir. 1906)."
        )
        found = check(text)
        assert len(found) >= 3
        assert [d.span.start for d in found] == sorted(d.span.start for d in found)

    @pytest.mark.parametrize(
        ("text", "expected"),
        [
            ("A v. B, 123 F. 3d 4 (9th Cir. 1997).", "RP001"),
            ("A v. B, 999 F.3d 1 (2d Cir. 1950).", "DT001"),
            ("A v. B, 5 F.4th 9 (1st Cir. 2099).", "DT002"),
            ("A v. B, 200 U.S. 1 (9th Cir. 1906).", "CT002"),
            ("As held in Ghost Corp., supra, at 3.", "ST001"),
        ],
    )
    def test_each_defect_is_caught_by_the_expected_rule(self, check, text, expected):
        assert expected in ids(check(text))

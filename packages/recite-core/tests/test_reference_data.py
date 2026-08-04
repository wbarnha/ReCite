"""The reporters-db and courts-db adapters."""

from __future__ import annotations

import pytest

from recite.core import (
    canonical_editions_for_variation,
    court_citation_string,
    court_info,
    differs_only_cosmetically,
    edition_info,
    editions_covering_year,
    is_known_edition,
    is_variation,
    resolve_court,
    series_editions,
    suggest_editions,
)


class TestEditions:
    def test_known_edition_carries_its_date_range(self):
        edition = edition_info("F.3d")
        assert edition is not None
        assert edition.series == "F."
        assert edition.start_year == 1993
        assert edition.is_current

    def test_unknown_edition_returns_none(self):
        assert edition_info("Xyz. 9th") is None

    def test_closed_edition_reports_both_bounds(self):
        edition = edition_info("F.2d")
        assert edition is not None
        assert (edition.start_year, edition.end_year) == (1924, 1993)
        assert not edition.is_current

    @pytest.mark.parametrize(
        ("year", "covered"), [(1992, False), (1993, True), (2024, True)]
    )
    def test_covers(self, year, covered):
        edition = edition_info("F.3d")
        assert edition is not None
        assert edition.covers(year) is covered

    def test_series_is_ordered_oldest_first(self):
        assert [e.name for e in series_editions("F.3d")] == [
            "F.",
            "F.2d",
            "F.3d",
            "F.4th",
        ]

    def test_editions_covering_year_finds_the_right_sibling(self):
        assert [e.name for e in editions_covering_year("F.3d", 1950)] == ["F.2d"]

    def test_is_known_edition(self):
        assert is_known_edition("F.3d")
        assert not is_known_edition("Fed. Rep.")


class TestVariations:
    @pytest.mark.parametrize("token", ["F. 3d", "U. S.", "Fed. Rep."])
    def test_recognised_variations(self, token):
        assert is_variation(token)

    @pytest.mark.parametrize("token", ["F.3d", "U.S."])
    def test_canonical_names_are_not_variations(self, token):
        assert not is_variation(token)

    def test_matches_reporters_db_spelling_without_the_space(self):
        # eyecite reports "Fed. Rep."; reporters-db indexes "Fed.Rep.".
        assert canonical_editions_for_variation("Fed. Rep.") == ["F."]

    @pytest.mark.parametrize(
        ("written", "canonical", "cosmetic"),
        [
            ("U. S.", "U.S.", True),
            ("US", "U.S.", True),
            ("F. 3d", "F.3d", True),
            ("Fed. Rep.", "F.", False),
        ],
    )
    def test_cosmetic_difference_detection(self, written, canonical, cosmetic):
        assert differs_only_cosmetically(written, canonical) is cosmetic


class TestSuggestions:
    def test_suggests_the_intended_reporter_for_a_typo(self):
        assert "Cal. Rptr. 3d" in suggest_editions("Cal. Rprt. 3d")

    def test_nonsense_gets_no_suggestion(self):
        assert suggest_editions("Xyzzy Quux") == []

    def test_suggestions_are_canonical_editions_not_variations(self):
        for suggestion in suggest_editions("F. 3d"):
            assert is_known_edition(suggestion)

    def test_empty_token_is_safe(self):
        assert suggest_editions("") == []


class TestCourts:
    def test_id_maps_to_its_bluebook_abbreviation(self):
        assert court_citation_string("ca9") == "9th Cir."
        assert court_citation_string("nysd") == "S.D.N.Y."

    def test_unknown_id_returns_none(self):
        assert court_citation_string("not-a-court") is None

    def test_court_info_carries_a_lifespan(self):
        court = court_info("ca9")
        assert court is not None
        assert court.start_year == 1891
        assert court.existed_in(1990)
        assert not court.existed_in(1800)

    def test_exact_abbreviation_resolves(self):
        assert resolve_court("9th Cir.") == "ca9"

    def test_full_court_name_resolves(self):
        assert resolve_court("Supreme Court of Texas") == "tex"

    def test_non_court_parenthetical_resolves_to_nothing(self):
        assert resolve_court("en banc") is None
        assert resolve_court("per curiam") is None

    def test_empty_string_resolves_to_nothing(self):
        assert resolve_court("") is None

    def test_excluding_bankruptcy_picks_out_the_district_court(self):
        # courts-db matches both the district and bankruptcy courts here, and
        # an ambiguous answer is discarded. Ruling out bankruptcy leaves the
        # one the citation actually meant.
        assert resolve_court("Southern District of New York") is None
        assert (
            resolve_court("Southern District of New York", bankruptcy=False) == "nysd"
        )

    def test_excluding_bankruptcy_avoids_naming_the_wrong_court(self):
        # Left alone, courts-db answers "nysb" — the *bankruptcy* court — for
        # what is plainly a district cite. Ruling it out yields no answer,
        # which is the safe outcome: no rename beats the wrong rename.
        assert resolve_court("S.D. New York") == "nysb"
        assert resolve_court("S.D. New York", bankruptcy=False) is None

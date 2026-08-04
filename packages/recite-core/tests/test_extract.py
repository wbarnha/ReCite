"""Extraction, including the guards against eyecite's ``full_span`` regression."""

from __future__ import annotations

import pytest

from recite.core import extract


class TestBasicExtraction:
    def test_finds_a_full_citation_with_its_parts(self):
        result = extract("Roe v. Wade, 410 U.S. 113 (1973).")
        (citation,) = result.citations

        assert citation.kind == "FullCaseCitation"
        assert (citation.volume, citation.reporter, citation.page) == (
            "410",
            "U.S.",
            "113",
        )
        assert citation.year == 1973
        assert citation.court_id == "scotus"
        assert citation.case_name == "Roe v. Wade"

    def test_spans_index_into_the_original_text(self):
        text = "See Roe v. Wade, 410 U.S. 113 (1973)."
        (citation,) = extract(text).citations
        assert citation.span.slice_of(text) == "410 U.S. 113"

    def test_reports_the_canonical_form_of_a_misspaced_reporter(self):
        (citation,) = extract(
            "Smith v. Jones, 123 F. 3d 456 (9th Cir. 1997)."
        ).citations
        assert citation.corrected == "123 F.3d 456"
        assert citation.reporter_canonical == "F.3d"

    def test_empty_text_yields_no_citations(self):
        assert extract("").citations == []

    def test_prose_without_citations_yields_nothing(self):
        assert extract("The motion is denied for the reasons stated.").citations == []


class TestYearAttribution:
    """eyecite 2.7.x can hand a citation the *previous* citation's year.

    These pin the workaround in :mod:`recite.core.extract`: the year is read
    from each citation's own trailing parenthetical.
    """

    def test_each_citation_keeps_its_own_year(self):
        text = (
            "A v. B, 1 U.S. 1 (1801). C v. D, 2 U.S. 2 (1802). E v. F, 3 U.S. 3 (1803)."
        )
        assert [c.year for c in extract(text).citations] == [1801, 1802, 1803]

    def test_descending_years_are_not_reordered(self):
        text = "A v. B, 410 U.S. 113 (1973). C v. D, 1 F.3d 1 (2d Cir. 1999)."
        assert [c.year for c in extract(text).citations] == [1973, 1999]

    def test_full_span_never_reaches_into_the_previous_citation(self):
        text = "A v. B, 1 U.S. 1 (1801). C v. D, 2 U.S. 2 (1802)."
        first, second = extract(text).citations
        assert second.full_span.start >= first.span.end
        assert text[second.full_span.start : second.full_span.end] == (
            "C v. D, 2 U.S. 2 (1802)"
        )

    def test_citation_without_a_parenthetical_has_no_invented_year(self):
        (citation,) = extract("The court cited 410 U.S. 113 in passing.").citations
        assert citation.year is None


class TestCourtParenthetical:
    @pytest.mark.parametrize(
        ("text", "expected"),
        [
            ("A v. B, 123 F.3d 4 (9th Cir. 1997).", "9th Cir."),
            ("A v. B, 700 F. Supp. 1 (S.D. New York 1990).", "S.D. New York"),
            ("A v. B, 410 U.S. 113 (1973).", None),  # year only, no court
        ],
    )
    def test_reads_the_court_as_written(self, text, expected):
        (citation,) = extract(text).citations
        assert citation.court_text == expected

    def test_court_text_span_points_at_the_court(self):
        text = "A v. B, 700 F. Supp. 1 (Southern District of New York 1990)."
        (citation,) = extract(text).citations
        assert citation.court_text_span is not None
        assert (
            citation.court_text_span.slice_of(text) == "Southern District of New York"
        )

    def test_takes_the_first_parenthetical_not_a_trailing_one(self):
        (citation,) = extract("A v. B, 123 F.3d 4 (9th Cir. 1997) (en banc).").citations
        assert citation.court_text == "9th Cir."


class TestShortFormResolution:
    def test_id_resolves_to_the_preceding_full_citation(self):
        text = "Roe v. Wade, 410 U.S. 113 (1973). Id. at 116."
        result = extract(text)
        full, short = result.citations

        assert short.kind == "IdCitation"
        assert short.resource_key == full.resource_key
        assert result.antecedent_of(short) is full

    def test_short_form_without_an_antecedent_is_reported_as_unresolved(self):
        result = extract("As explained in Ghost Corp., supra, at 3, the rule holds.")
        assert [c.kind for c in result.unresolved] == ["SupraCitation"]

    def test_a_resolved_short_form_is_not_unresolved(self):
        result = extract("Roe v. Wade, 410 U.S. 113 (1973). Id. at 116.")
        assert result.unresolved == []

    def test_resources_group_citations_by_case(self):
        text = "Roe v. Wade, 410 U.S. 113 (1973). Id. at 116. Id. at 120."
        result = extract(text)
        assert len(result.resources) == 1
        assert len(next(iter(result.resources.values()))) == 3


class TestReporterMetadata:
    def test_flags_a_supreme_court_only_reporter(self):
        (citation,) = extract("A v. B, 410 U.S. 113 (1973).").citations
        assert citation.reporter_is_scotus is True

    def test_regional_reporter_is_not_scotus_only(self):
        (citation,) = extract("A v. B, 123 F.3d 4 (9th Cir. 1997).").citations
        assert citation.reporter_is_scotus is False

    def test_lookup_key_is_the_canonical_form(self):
        (citation,) = extract("A v. B, 550 US 544 (2007).").citations
        assert citation.lookup_key == "550 US 544"
        assert citation.lookup_parts == ("550", "U.S.", "544")


def test_cleaning_rewrites_the_document_the_spans_refer_to():
    result = extract("<p>Roe v. Wade, 410 U.S. 113 (1973).</p>", clean=["html"])
    (citation,) = result.citations
    assert "<p>" not in result.text
    assert citation.span.slice_of(result.text) == "410 U.S. 113"


def test_to_dict_is_json_serialisable():
    import json

    (citation,) = extract("Roe v. Wade, 410 U.S. 113 (1973).").citations
    assert json.loads(json.dumps(citation.to_dict()))["corrected"] == "410 U.S. 113"
